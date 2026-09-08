import { test } from 'node:test'
import assert from 'node:assert/strict'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { createTorrentSource } from '../torrent.js'
import { createHTTPSource } from '../http.js'
import { matchSeries, sameRelease, episodeNumber, isBatchTorrent, onlineState } from '../lib/matching.js'
import { mergeSeries } from '../lib/merge-catalog.js'

const name = '[Erai-raws] Demo - 02 [1080p][AAAAAAAA].mkv'
const ep = (overrides = {}) => ({ episode: 2, resolution: '1080', fileName: name, url: 'https://video.invalid/' + encodeURIComponent(name), ...overrides })
const series = episodes => [{ title: 'Demo', anilistId: 123, episodes }]
const query = { titles: ['Demo'], anilistId: 123, episode: 2 }
async function fixture(file = name, size = 123, overrides = {}) {
  const pieceLength = 16 * 1024 * 1024
  const bytes = toTorrentFile({ info: { name: new TextEncoder().encode(file), length: size, 'piece length': pieceLength, pieces: new Uint8Array(Math.ceil(size / pieceLength) * 20), ...overrides } })
  return { bytes, parsed: await parseTorrent(bytes) }
}
function mock(catalog, items = [], files = {}) {
  const requests = []
  const fetch = async url => {
    requests.push(url)
    if (url.includes('indexed-catalog.json')) return Response.json(catalog)
    if (url.includes('feed.animetosho.org')) return Response.json(items)
    if (files[url]) return new Response(files[url])
    return new Response('missing', { status: 404 })
  }
  return { fetch, requests }
}
test('regression: unrelated torrents and contradictory CRCs are rejected', async () => {
  const wrong = await fixture('[Other] Different - 02 [1080p][BBBBBBBB].mkv')
  const f = mock(series([ep()]), [{ title: name, info_hash: wrong.parsed.infoHash, torrent_url: 'https://torrent.invalid/wrong' }], { 'https://torrent.invalid/wrong': wrong.bytes })
  assert.deepEqual(await createTorrentSource().single({ ...query, fetch: f.fetch }), [])
  assert.equal(sameRelease(ep(), name.replace('AAAAAAAA', 'BBBBBBBB')), false)
  assert.equal(sameRelease(ep(), '[Other] Different - 02 [1080p][AAAAAAAA].mkv'), false)
})
test('validated metadata determines title, hash and size, not the search feed', async () => {
  const correct = await fixture()
  const f = mock(series([ep()]), [{ title: name, info_hash: correct.parsed.infoHash, torrent_url: 'https://torrent.invalid/right', total_size: 99e9 }], { 'https://torrent.invalid/right': correct.bytes })
  const [result] = await createTorrentSource().single({ ...query, fetch: f.fetch })
  assert.equal(result.hash, correct.parsed.infoHash)
  assert.equal(result.size, 123)
  assert.equal(result.seeders, 0)
  assert.equal(result.downloads, 0)
  assert.match(result.title, /DDL sin verificar/)
})
test('prelinked torrent is also checked against hash and actual filename', async () => {
  const correct = await fixture()
  const f = mock(series([ep({ torrentPath: 'torrents/a.torrent', infoHash: correct.parsed.infoHash })]), [], { 'http://127.0.0.1:8787/torrents/a.torrent': correct.bytes })
  assert.equal((await createTorrentSource().single({ ...query, fetch: f.fetch })).length, 1)
  assert.equal(f.requests.some(url => url.includes('animetosho')), false)
  const wrongHash = mock(series([ep({ torrentPath: 'torrents/a.torrent', infoHash: 'b'.repeat(40) })]), [], { 'http://127.0.0.1:8787/torrents/a.torrent': correct.bytes })
  assert.deepEqual(await createTorrentSource().single({ ...query, fetch: wrongHash.fetch }), [])
})
test('all-batch search results never re-enter the candidate pool', async () => {
  const f = mock(series([ep()]), [{ title: name + ' Complete Series Batch', info_hash: 'a'.repeat(40), torrent_url: 'https://torrent.invalid/batch' }])
  assert.deepEqual(await createTorrentSource().single({ ...query, fetch: f.fetch }), [])
  assert.equal(f.requests.includes('https://torrent.invalid/batch'), false)
  assert.equal(isBatchTorrent({ files: [{ name: 'movie.mkv' }, { name: 'en.ass' }, { name: 'es.ass' }, { name: 'readme.txt' }] }), false)
  assert.equal(isBatchTorrent({ files: [{ name: '01.mkv' }, { name: '02.mkv' }] }), true)
})
test('movie() supports a single large file with no episode number', async () => {
  const movie = 'Your Name (2016) [1080p][AAAAAAAA].mkv'
  const data = await fixture(movie, 15_000_000_000)
  const f = mock([{ title: 'Your Name', anilistId: 123, episodes: [ep({ episode: 1, fileName: movie, url: 'https://video.invalid/' + encodeURIComponent(movie) })] }],
    [{ title: movie, info_hash: data.parsed.infoHash, torrent_url: 'https://torrent.invalid/movie' }], { 'https://torrent.invalid/movie': data.bytes })
  const [result] = await createTorrentSource().movie({ ...query, titles: ['Your Name'], fetch: f.fetch })
  assert.equal(result.size, 15_000_000_000)
})
test('HTTP resolution and codec mismatch cannot win on a zero score', async () => {
  const f = mock(series([ep()]))
  const source = createHTTPSource()
  assert.equal(await source.single({ ...query, fetch: f.fetch, file: { name: 'Demo - 02 [720p].mkv' } }), undefined)
  assert.equal(await source.single({ ...query, fetch: f.fetch, file: { name: 'Demo - 02 [1080p].mkv' } }), undefined)
  assert.deepEqual(await source.single({ ...query, fetch: f.fetch, file: { name, index: 0 } }), { url: ep().url, index: 0 })
  assert.equal(sameRelease(ep({ url: 'https://video.invalid/Demo%20AVC.mkv' }), 'Demo HEVC.mkv'), false)
})
test('HTTP batch resolves each file episode independently, including episode zero', async () => {
  const zeroName = name.replace('- 02', '- 00')
  const episodes = [ep(), ep({ episode: 0, fileName: zeroName, url: 'https://video.invalid/' + encodeURIComponent(zeroName) })]
  const f = mock(series(episodes))
  const source = createHTTPSource()
  const result = await source.batch({ ...query, fetch: f.fetch, files: [{ name, index: 2 }, { name: zeroName, index: 0 }, { name: 'subtitles.ass', index: 4 }] })
  assert.deepEqual(result.map(r => r.index), [2, 0])
  assert.equal((await source.single({ ...query, episode: 0, fetch: f.fetch, file: { name: zeroName, index: 0 } })).url, episodes[1].url)
})
test('IDs exclude contradictory mappings; Unicode, aliases and unique typos work', () => {
  const data = [{ title: 'Mashle', anilistId: 1 }, { title: 'Mashle 2nd Season', anilistId: 2 }, { title: '日本語' }, { title: 'Taboo Tatoo' }]
  assert.deepEqual(matchSeries(data, ['Mashle'], 3), [])
  assert.deepEqual(matchSeries(data, ['Mashle'], 2), [data[1]])
  assert.deepEqual(matchSeries(data, ['日本語']), [data[2]])
  assert.deepEqual(matchSeries(data, ['Taboo Tattoo']), [data[3]])
  assert.deepEqual(matchSeries(data, ['']), [])
})
test('episode extraction keeps decimals and does not confuse season, year or bit depth', () => {
  for (let n = 1; n <= 12; n++) assert.equal(episodeNumber(`Show.S02E${String(n).padStart(2, '0')}.1080p.mkv`), n)
  assert.equal(episodeNumber('[Group] 86 - 02 [1080p 10-bit].mkv'), 2)
  assert.equal(episodeNumber('Show - 12.5 [720p].mkv'), 12.5)
  assert.equal(episodeNumber('Show 2nd Season (2016) [1080p 10-bit].mkv'), null)
})
test('legacy online flags are not treated as verified; expired checks become unknown', () => {
  assert.equal(onlineState({ isOnline: true }), null)
  assert.equal(onlineState({ isOnline: true, checkedAt: '2020-01-01' }), null)
  assert.equal(onlineState({ isOnline: false, checkedAt: new Date().toISOString() }), false)
})
test('refresh preserves IDs and hashes only for the exact file URL', () => {
  const previous = { title: 'Demo', anilistId: 123, aliases: ['Alias'], episodes: [ep({ infoHash: 'a'.repeat(40) })] }
  const kept = mergeSeries(previous, { title: 'Demo', episodes: [ep()] })
  assert.equal(kept.anilistId, 123)
  assert.equal(kept.episodes[0].infoHash, 'a'.repeat(40))
  assert.deepEqual(kept.aliases, ['Alias'])
  assert.equal(mergeSeries(previous, { title: 'Demo', episodes: [ep({ url: 'https://other.invalid/other.mkv' })] }).episodes[0].infoHash, undefined)
})

test('requested resolution and exclusions apply before searching; results deduplicate by hash', async () => {
  const data = await fixture()
  const entry = ep({ torrentPath: 'torrents/a.torrent', infoHash: data.parsed.infoHash })
  const f = mock(series([entry, entry]), [], { 'http://127.0.0.1:8787/torrents/a.torrent': data.bytes })
  const source = createTorrentSource()
  assert.deepEqual(await source.single({ ...query, resolution: '720', fetch: f.fetch }), [])
  assert.equal(f.requests.some(u => u.includes('animetosho')), false)
  assert.deepEqual(await source.single({ ...query, exclusions: ['Erai-raws'], fetch: f.fetch }), [])
  assert.equal((await source.single({ ...query, resolution: '1080', fetch: f.fetch })).length, 1)
})

test('the resolver distinguishes all twelve Mashle S2 episodes in both resolutions', async () => {
  const episodes = [], files = {}
  for (let number = 1; number <= 12; number++) for (const res of ['1080', '720']) {
    const file = `[Erai-raws] Mashle 2nd Season - ${String(number).padStart(2, '0')} [${res}p].mkv`
    const data = await fixture(file)
    const path = `torrents/${number}-${res}.torrent`
    episodes.push({ episode: number, resolution: res, url: 'https://video.invalid/' + encodeURIComponent(file), torrentPath: path, infoHash: data.parsed.infoHash })
    files['http://127.0.0.1:8787/' + path] = data.bytes
  }
  const f = mock([{ title: 'Mashle 2nd Season', anilistId: 166610, episodes }], [], files)
  const source = createTorrentSource()
  for (let number = 1; number <= 12; number++) {
    const results = await source.single({ titles: ['Mashle 2nd Season'], anilistId: 166610, episode: number, fetch: f.fetch })
    assert.equal(results.length, 2)
    assert.equal(new Set(results.map(r => r.hash)).size, 2)
    for (const r of results) assert.equal(episodeNumber(r.title), number)
  }
})
