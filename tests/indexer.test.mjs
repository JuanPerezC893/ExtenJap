import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toTorrentFile, default as parseTorrent } from 'parse-torrent'
import { verifyPieceHashes, saveVerifiedMatches, loadVerifiedMatches, episodeReleaseMatch, runIndexer } from '../indexer.mjs'
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

