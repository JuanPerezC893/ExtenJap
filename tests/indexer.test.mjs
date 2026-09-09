import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
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

test('indexer: guardado atómico y protección ante corrupción en verified-matches.json', () => {
  const originalVerified = loadVerifiedMatches()

  // Probar guardado atómico
  saveVerifiedMatches({ ...originalVerified, testKey: 12345 })
  const reloaded = loadVerifiedMatches()
  assert.equal(reloaded.testKey, 12345)

  // Restaurar original
  saveVerifiedMatches(originalVerified)

  // Probar que ante JSON corrupto genera respaldo y lanza error en vez de resetear silenciosamente
  const backupOriginal = fs.readFileSync('verified-matches.json', 'utf8')
  fs.writeFileSync('verified-matches.json', '{"incompleto": ', 'utf8')

  try {
    assert.throws(() => {
      loadVerifiedMatches()
    }, /Error crítico al leer/)
    // Verificar que se creó un archivo de respaldo corrupt
    const corruptFiles = fs.readdirSync('.').filter(f => f.startsWith('verified-matches.json.corrupt.'))
    assert.ok(corruptFiles.length > 0, 'Debe crearse un archivo de respaldo del JSON corrupto')
    // Limpiar archivos de prueba corrupt
    for (const cf of corruptFiles) fs.unlinkSync(cf)
  } finally {
    fs.writeFileSync('verified-matches.json', backupOriginal, 'utf8')
  }
})

test('indexer: runIndexer admite concurrencia y procesa workers paralelos', async () => {
  // Ejecutar con filtro inexistente para validar la inicialización de workers concurrentes
  await assert.doesNotReject(async () => {
    await runIndexer({
      seriesFilter: ['__serie_inexistente_para_test__'],
      concurrency: 3,
      useProxy: false
    })
  })
})

test('indexer: resuelve candidato vía AnimeTosho cuando Nyaa/NekoBT entregan HTML de Cloudflare (Google Colab)', async () => {
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
      return new Response(piece0, {
        status: 206,
        headers: { 'content-range': `bytes 0-${piece0.length - 1}/${piece0.length}` }
      })
    }
    return new Response(null, { status: 404 })
  }

  const result = await findAndPrepareTorrent(series, ep, {
    fetchFn: mockFetch,
    detailed: true,
    stateDir: 'tests/scratch-colab-test'
  })

  assert.equal(result.status, 'prepared', 'El episodio debe quedar preparado')
  assert.equal(result.match.infoHash, dummyParsed.infoHash, 'El infoHash debe coincidir')
  assert.equal(result.match.piecesVerified, true, 'Las piezas deben estar verificadas')

  // Limpiar scratch creado en el test
  if (fs.existsSync('tests/scratch-colab-test')) {
    fs.rmSync('tests/scratch-colab-test', { recursive: true, force: true })
  }
})

test('indexer: errores de red/cooldown difieren el episodio en vez de marcar incompatible', async () => {
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
    stateDir: 'tests/scratch-colab-test2'
  })

  assert.equal(result.status, 'deferred', 'El episodio debe quedar diferido por fallo de red')
  assert.equal(result.incompatible, 0, 'No debe incrementar incompatible ante errores de red')

  if (fs.existsSync('tests/scratch-colab-test2')) {
    fs.rmSync('tests/scratch-colab-test2', { recursive: true, force: true })
  }
})



