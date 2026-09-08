import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTorrentSource } from '../torrent.js'
import { sameRelease, isBatchTorrent, episodeNumber, seasonNumber } from '../lib/matching.js'

test('torrent.js: lee catálogo dividido dist/data/<anilistId>.json con accuracy high', async () => {
  const fakeAnilistId = 166610
  const fakeEpisode = {
    episode: 1,
    resolution: '1080',
    quality: '1080p',
    fileName: '[Erai-raws] Mashle 2nd Season - 01 [1080p].mkv',
    size: 1448646250,
    hash: '0e50fd7d3f75e6aff117b9c5ce6f97db84789de9',
    torrent: 'torrents/0e50fd7d3f75e6aff117b9c5ce6f97db84789de9.torrent',
    url: 'https://emision.craftervault.com/mashle1.mkv',
    verified: true
  }

  const mockFetch = async (url) => {
    if (url.includes(`data/${fakeAnilistId}.json`)) {
      return {
        ok: true,
        json: async () => ({
          anilistId: fakeAnilistId,
          title: 'Mashle 2nd Season',
          episodes: [fakeEpisode]
        })
      }
    }
    return { ok: false, status: 404 }
  }

  const source = createTorrentSource('https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/')
  const results = await source.single({
    anilistId: fakeAnilistId,
    episode: 1,
    resolution: '1080',
    fetch: mockFetch
  })

  assert.equal(results.length, 1, 'Debe retornar el episodio verificado')
  assert.equal(results[0].hash, '0e50fd7d3f75e6aff117b9c5ce6f97db84789de9')
  assert.equal(results[0].accuracy, 'high')
  assert.match(results[0].title, /\[DDL verificado\]/)
  assert.equal(results[0].link, 'https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/torrents/0e50fd7d3f75e6aff117b9c5ce6f97db84789de9.torrent')
})

test('torrent.js: no realiza búsquedas dinámicas externas si no existe catálogo preparado', async () => {
  const unindexedId = 777777
  const requests = []

  const mockFetch = async (url) => {
    requests.push(url)
    return { ok: false, status: 404 }
  }

  const source = createTorrentSource('https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/')
  const results = await source.single({
    anilistId: unindexedId,
    episode: 1,
    resolution: '1080',
    fetch: mockFetch
  })

  assert.deepEqual(results, [], 'Debe retornar vacío sin intentar adivinar')
  assert.equal(requests.some(u => u.includes('animetosho')), false, 'NUNCA debe llamar a AnimeTosho en runtime')
  assert.equal(requests.some(u => u.includes('indexed-catalog.json')), false, 'NUNCA debe descargar el catálogo masivo en runtime')
})

test('torrent.js: respeta exclusiones y filtra resolución correctamente', async () => {
  const fakeAnilistId = 12345
  const episodes = [
    { episode: 2, resolution: '1080', fileName: 'Show - 02 [1080p].mkv', hash: 'a'.repeat(40), torrent: 't/a.torrent', size: 100 },
    { episode: 2, resolution: '720', fileName: 'Show - 02 [720p].mkv', hash: 'b'.repeat(40), torrent: 't/b.torrent', size: 50 },
    { episode: 2, resolution: '1080', fileName: 'Show - 02 [1080p] [DUB].mkv', hash: 'c'.repeat(40), torrent: 't/c.torrent', size: 100 }
  ]

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ anilistId: fakeAnilistId, episodes })
  })

  const source = createTorrentSource('https://example.invalid/dist/')

  // Filtrar 720p
  const res720 = await source.single({ anilistId: fakeAnilistId, episode: 2, resolution: '720', fetch: mockFetch })
  assert.equal(res720.length, 1)
  assert.equal(res720[0].hash, 'b'.repeat(40))

  // Exclusiones: descartar DUB
  const resExcl = await source.single({ anilistId: fakeAnilistId, episode: 2, resolution: '1080', exclusions: ['dub'], fetch: mockFetch })
  assert.equal(resExcl.length, 1)
  assert.equal(resExcl[0].hash, 'a'.repeat(40))
})

test('torrent.js: movie() resuelve películas con episodio 1', async () => {
  const movieEpisode = {
    episode: 1,
    resolution: '1080',
    fileName: 'Movie [1080p].mkv',
    hash: 'd'.repeat(40),
    torrent: 't/movie.torrent',
    size: 5000000000
  }

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ anilistId: 999, episodes: [movieEpisode] })
  })

  const source = createTorrentSource('https://example.invalid/dist/')
  const results = await source.movie({ anilistId: 999, resolution: '1080', fetch: mockFetch })
  assert.equal(results.length, 1)
  assert.equal(results[0].hash, 'd'.repeat(40))
})

test('matching: sameRelease rechaza CRCs contradictorios y resoluciones distintas', () => {
  const ep = { fileName: '[Erai-raws] Title - 01 [1080p][AAAAAAAA].mkv', resolution: '1080', crc32: 'AAAAAAAA' }
  assert.equal(sameRelease(ep, '[Erai-raws] Title - 01 [1080p][AAAAAAAA].mkv'), true)
  assert.equal(sameRelease(ep, '[Erai-raws] Title - 01 [1080p][BBBBBBBB].mkv'), false)
  assert.equal(sameRelease(ep, '[Erai-raws] Title - 01 [720p][AAAAAAAA].mkv'), false)
  assert.equal(sameRelease(ep, '[SubsPlease] Title - 01 [1080p][AAAAAAAA].mkv'), false)
})

test('matching: isBatchTorrent detecta lotes y permite archivos individuales', () => {
  assert.equal(isBatchTorrent({ files: [{ name: '01.mkv' }, { name: '02.mkv' }] }), true)
  assert.equal(isBatchTorrent({ files: [{ name: 'movie.mkv' }, { name: 'subs.ass' }] }), false)
  assert.equal(isBatchTorrent({ title: 'Show - 01-12 [Batch]' }), true)
  assert.equal(isBatchTorrent({ title: 'Show Season 1 Complete' }), true)
  assert.equal(isBatchTorrent({ title: '[Erai-raws] Show - 01 [1080p]' }), false)
})

test('matching: episodeNumber y seasonNumber extraen números correctamente', () => {
  assert.equal(episodeNumber('Show - 02 [1080p]'), 2)
  assert.equal(episodeNumber('Show S02E12 [1080p]'), 12)
  assert.equal(episodeNumber('Show Season 2 - 01'), 1)
  assert.equal(seasonNumber('Show 2nd Season'), 2)
  assert.equal(seasonNumber('Show Season 3'), 3)
})
