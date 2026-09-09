import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
function tempState(t) {
  const path = fs.mkdtempSync(join(tmpdir(), 'japanpaw-index-test-'))
  t.after(() => { if (!resolve(path).startsWith(resolve(tmpdir()) + sep + 'japanpaw-index-test-')) throw new Error('Unsafe cleanup'); fs.rmSync(path, { recursive: true, force: true }) })
  return path
}
import { toTorrentFile, default as parseTorrent } from 'parse-torrent'
import { verifyPieceHashes, saveVerifiedMatches, loadVerifiedMatches, episodeReleaseMatch, runIndexer, findAndPrepareTorrent } from '../indexer.mjs'
import { createHash } from 'node:crypto'

test('indexer: toTorrentFile inyecta url-list (BEP-19 WebSeed) preservando el infoHash', async () => {
  const dummy = {
    info: {
      name: 'video-sample.mkv',
      length: 1048576,
      'piece length': 262144,
      pieces: Buffer.alloc(20 * 4, 7)
    }
  }

  const bufOrig = toTorrentFile(dummy)
  const origParsed = await parseTorrent(bufOrig)

  const withWebSeed = {
    ...dummy,
    urlList: ['https://emision.craftervault.com/video-sample.mkv']
  }
  const bufWebSeed = toTorrentFile(withWebSeed)
  const webSeedParsed = await parseTorrent(bufWebSeed)

  assert.equal(origParsed.infoHash, webSeedParsed.infoHash, 'El infoHash debe ser idéntico con y sin WebSeed')
  assert.deepEqual(webSeedParsed.urlList, ['https://emision.craftervault.com/video-sample.mkv'], 'El urlList debe contener la URL directa')
})

test('indexer: verifyPieceHashes valida piezas inicial y final por SHA-1', async () => {
  const piece0 = Buffer.from('PRIMERA_PIEZA_DEL_VIDEO_PROBANDO_HASH_1234567890')
  const pieceLast = Buffer.from('ULTIMA_PIEZA__DEL_VIDEO_PROBANDO_HASH_0987654321')
  const hash0 = createHash('sha1').update(piece0).digest('hex')
  const hashLast = createHash('sha1').update(pieceLast).digest('hex')

  const parsed = {
    length: piece0.length * 2,
    pieceLength: piece0.length,
    pieces: [hash0, hashLast]
  }

  const mockFetch = async (url, options) => {
    const range = options?.headers?.Range
    if (range.startsWith('bytes=0-')) {
      return {
        status: 206,
        headers: new Map([['content-range', `bytes 0-${piece0.length - 1}/${parsed.length}`]]),
        arrayBuffer: async () => piece0
      }
    }
    return {
      status: 206,
      headers: new Map([['content-range', `bytes ${piece0.length}-${parsed.length - 1}/${parsed.length}`]]),
      arrayBuffer: async () => pieceLast
    }
  }

  const origFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  try {
    const ok = await verifyPieceHashes('https://mock.invalid/video.mkv', parsed)
    assert.equal(ok, true, 'verifyPieceHashes debe validar con éxito')
  } finally {
    globalThis.fetch = origFetch
  }
})

test('indexer: episodeReleaseMatch distingue versiones con diferente release/archivo', () => {
  const epA = {
    episode: 1,
    resolution: '1080',
    fileName: '[Erai-raws] Show - 01 [1080p].mkv',
    url: 'https://cdn.invalid/Erai.mkv'
  }
  const epB = {
    episode: 1,
    resolution: '1080',
    fileName: '[SubsPlease] Show - 01 [1080p].mkv',
    url: 'https://cdn.invalid/SubsPlease.mkv'
  }

  const recordA = {
    episode: 1,
    resolution: '1080',
    fileName: '[Erai-raws] Show - 01 [1080p].mkv',
    directUrl: 'https://cdn.invalid/Erai.mkv'
  }

  assert.equal(episodeReleaseMatch(recordA, epA), true, 'Debe coincidir con la misma release')
  assert.equal(episodeReleaseMatch(recordA, epB), false, 'Debe rechazar una release diferente de 1080p')
})

test('indexer: guardado atómico y protección ante corrupción sin tocar datos del usuario', t => {
  const dir = tempState(t)
  saveVerifiedMatches({ series: {}, testKey: 12345 }, dir)
  assert.equal(loadVerifiedMatches(dir).testKey, 12345)
  fs.writeFileSync(join(dir, 'verified-matches.json'), '{"incompleto": ')
  assert.throws(() => loadVerifiedMatches(dir), /Error crítico al leer/)
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('verified-matches.json.corrupt.')))
  assert.equal(fs.readFileSync(join(dir, 'verified-matches.json'), 'utf8'), '{"incompleto": ')
})

test('indexer: inicialización vacía no realiza solicitudes ni modifica catálogo', async t => {
  const dir = tempState(t), catalogPath = join(dir, 'catalog.json')
  fs.writeFileSync(catalogPath, '[]')
  const result = await runIndexer({ stateDir: dir, catalogPath, concurrency: 3, log: () => {}, fetchFn: async () => { throw new Error('Unexpected network') } })
  assert.equal(result.attempted, 0)
  assert.equal(fs.readFileSync(catalogPath, 'utf8'), '[]')
})

test('indexer: resuelve candidato vía AnimeTosho cuando Nyaa/NekoBT entregan HTML de Cloudflare (fixture sin red)', async t => {
  const stateDir = tempState(t)
  const piece0 = Buffer.alloc(1048576, 65)
  const pieceHash = createHash('sha1').update(piece0).digest('hex')
  const dummyTorrent = {
    info: {
      name: '[TestGroup] Test Show - 01 [1080p][A1B2C3D4].mkv',
      length: piece0.length,
      'piece length': piece0.length,
      pieces: Buffer.from(pieceHash, 'hex')
    }
  }
  const torrentBytes = toTorrentFile(dummyTorrent)
  const dummyParsed = await parseTorrent(torrentBytes)

  const series = {
    title: 'Test Show',
    anilistId: 99999,
    episodes: [{ episode: 1, resolution: '1080', fileName: '[TestGroup] Test Show - 01 [1080p][A1B2C3D4].mkv', url: 'https://emision.craftervault.com/video.mkv' }]
  }
  const ep = series.episodes[0]

  const mockFetch = async (url, opts) => {
    const u = new URL(url)
    // 1. Búsqueda AniSearch por CRC
    if (u.hostname === 'api.anisearch.org') {
      return new Response(JSON.stringify([
        {
          torrentName: '[TestGroup] Test Show - 01 [1080p][A1B2C3D4].mkv',
          torrentFileUrl: 'https://nyaa.si/download/777.torrent',
          infohash: dummyParsed.infoHash,
          length: piece0.length
        }
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    // 2. Nyaa devuelve HTTP 200 con HTML de Cloudflare (como en Google Colab)
    if (u.hostname === 'nyaa.si') {
      return new Response('<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=UTF-8' }
      })
    }
    // 3. Espejo AnimeTosho por hash o nyaa_id
    if (u.hostname === 'feed.animetosho.xyz') {
      return new Response(JSON.stringify([
        {
          id: 1234,
          title: '[TestGroup] Test Show - 01 [1080p][A1B2C3D4].mkv',
          torrent_url: 'https://animetosho.xyz/download/1234/torrent',
          info_hash: dummyParsed.infoHash
        }
      ]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    // 4. Descarga del torrent desde AnimeTosho
    if (u.hostname === 'animetosho.xyz') {
      return new Response(torrentBytes, {
        status: 200,
        headers: { 'content-type': 'application/x-bittorrent' }
      })
    }
    // 5. Verificación de piezas Range en Craftervault
    if (u.hostname === 'emision.craftervault.com') {
      const [, start, end] = opts.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number)
      return new Response(piece0.subarray(start, end + 1), { status: 206, headers: { 'content-range': `bytes ${start}-${end}/${piece0.length}` } })
    }
    return new Response(null, { status: 404 })
  }

  const result = await findAndPrepareTorrent(series, ep, {
    fetchFn: mockFetch,
    detailed: true,
    stateDir
  })

  assert.equal(result.status, 'prepared', 'El episodio debe quedar preparado')
  assert.equal(result.match.infoHash, dummyParsed.infoHash, 'El infoHash debe coincidir')
  assert.equal(result.match.piecesVerified, true, 'Las piezas deben estar verificadas')


})

test('indexer: errores de red/cooldown difieren el episodio en vez de marcar incompatible', async t => {
  const piece0 = Buffer.from('TEST_DATA_BYTES_FOR_PIECE_CHECK')
  const fileName = '[Group] Network Fail Show - 01 [1080p][12345678].mkv'
  const dummy = {
    info: {
      name: fileName,
      length: piece0.length,
      'piece length': piece0.length,
      pieces: Buffer.from(createHash('sha1').update(piece0).digest('hex'), 'hex')
    }
  }
  const torrentBytes = toTorrentFile(dummy)
  const dummyParsed = await parseTorrent(torrentBytes)

  const series = {
    title: 'Network Fail Show',
    anilistId: 88888,
    episodes: [{ episode: 1, resolution: '1080', fileName: '[Group] Network Fail Show - 01 [1080p][12345678].mkv', url: 'https://emision.craftervault.com/fail.mkv' }]
  }
  const ep = series.episodes[0]

  const mockFetch = async (url) => {
    const u = new URL(url)
    if (u.hostname === 'feed.animetosho.xyz' || u.hostname === 'feed.animetosho.org') {
      return new Response(JSON.stringify([{
        id: 999,
        title: '[Group] Network Fail Show - 01 [1080p][12345678].mkv',
        torrent_url: 'https://animetosho.xyz/download/999/torrent',
        info_hash: dummyParsed.infoHash
      }]), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (u.hostname === 'animetosho.xyz') {
      return new Response(torrentBytes, { status: 200, headers: { 'content-type': 'application/x-bittorrent' } })
    }
    // Craftervault devuelve un error de red o timeout
    if (u.hostname === 'emision.craftervault.com') {
      const err = new Error('HTTP 403 en archivo de emision.craftervault.com')
      err.code = 'HTTP_ERROR'
      throw err
    }
    return new Response(null, { status: 404 })
  }

  const result = await findAndPrepareTorrent(series, ep, {
    fetchFn: mockFetch,
    detailed: true,
    stateDir: tempState(t)
  })

  assert.equal(result.status, 'deferred', 'El episodio debe quedar diferido por fallo de red')
  assert.equal(result.incompatible, 0, 'No debe incrementar incompatible ante errores de red')


})



