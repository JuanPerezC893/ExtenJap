import test from 'node:test'
import assert from 'node:assert/strict'
import { toTorrentFile, default as parseTorrent } from 'parse-torrent'
import { createTorrentSource } from '../torrent.js'
import { verifyPieceHashes } from '../indexer.mjs'
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

test('torrent.js: lee catálogo dividido dist/data/<anilistId>.json con accuracy high', async () => {
  const fakeAnilistId = 999999
  const fakeEpisode = {
    episode: 1,
    resolution: '1080',
    quality: '1080p',
    fileName: '[Fansub] Fake Anime - 01 [1080p].mkv',
    size: 1500000000,
    hash: 'a'.repeat(40),
    torrent: 'torrents/' + 'a'.repeat(40) + '.torrent',
    url: 'https://emision.craftervault.com/fake.mkv',
    verified: true
  }

  const mockFetch = async (url) => {
    if (url.includes(`data/${fakeAnilistId}.json`)) {
      return {
        ok: true,
        json: async () => ({
          anilistId: fakeAnilistId,
          title: 'Fake Anime',
          episodes: [fakeEpisode]
        })
      }
    }
    return { ok: false, status: 404 }
  }

  const source = createTorrentSource('https://example.invalid/dist/indexed-catalog.json')
  const results = await source.single({
    anilistId: fakeAnilistId,
    episode: 1,
    resolution: '1080',
    fetch: mockFetch
  })

  assert.equal(results.length, 1, 'Debe retornar exactamente un resultado')
  assert.equal(results[0].hash, 'a'.repeat(40), 'El infoHash debe coincidir')
  assert.equal(results[0].accuracy, 'high', 'Debe tener accuracy high al provenir del catálogo pre-verificado')
  assert.equal(results[0].link, `https://example.invalid/dist/torrents/${'a'.repeat(40)}.torrent`)
  assert.match(results[0].title, /\[DDL verificado\]/)
})

test('torrent.js: fallback a búsqueda dinámica cuando no existe dist/data/<anilistId>.json', async () => {
  const missingId = 888888
  const dummyTorrent = {
    info: {
      name: '[Fansub] Fallback Anime - 02 [1080p].mkv',
      length: 262144,
      'piece length': 262144,
      pieces: Buffer.alloc(20)
    }
  }
  const dummyBuf = toTorrentFile(dummyTorrent)
  const parsedDummy = await parseTorrent(dummyBuf)
  const realHash = parsedDummy.infoHash

  const catalog = [
    {
      title: 'Fallback Anime',
      anilistId: missingId,
      episodes: [
        {
          episode: 2,
          resolution: '1080',
          fileName: '[Fansub] Fallback Anime - 02 [1080p].mkv',
          url: 'https://emision.craftervault.com/%5BFansub%5D%20Fallback%20Anime%20-%2002%20%5B1080p%5D.mkv',
          infoHash: realHash,
          torrentPath: 'torrents/' + realHash + '.torrent',
          size: 262144
        }
      ]
    }
  ]

  const mockFetch = async (url) => {
    if (url.includes(`data/${missingId}.json`)) {
      return { ok: false, status: 404 }
    }
    if (url.includes('indexed-catalog.json')) {
      return { ok: true, json: async () => catalog }
    }
    if (url.includes('torrents/')) {
      return { ok: true, arrayBuffer: async () => dummyBuf }
    }
    return { ok: false, status: 404 }
  }

  const source = createTorrentSource('https://example.invalid/dist/indexed-catalog.json')
  const results = await source.single({
    anilistId: missingId,
    episode: 2,
    resolution: '1080',
    fetch: mockFetch
  })

  assert.equal(results.length, 1, 'Debe resolver mediante el catálogo fallback')
  assert.equal(results[0].hash, realHash)
})

test('indexer: verifyPieceHashes valida piezas inicial y final por SHA-1', async () => {
  const piece0 = Buffer.from('PRIMERA_PIEZA_DEL_VIDEO_PROBANDO_HASH_1234567890')
  const pieceLast = Buffer.from('ULTIMA_PIEZA_DEL_VIDEO_PROBANDO_HASH_0987654321')
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

  // Sustituir global fetch temporalmente
  const origFetch = globalThis.fetch
  globalThis.fetch = mockFetch
  try {
    const ok = await verifyPieceHashes('https://mock.invalid/video.mkv', parsed)
    assert.equal(ok, true, 'verifyPieceHashes debe validar con éxito')
  } finally {
    globalThis.fetch = origFetch
  }
})
