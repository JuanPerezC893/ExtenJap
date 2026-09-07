import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import parseTorrent from 'parse-torrent'
import { parseSeries, cleanUrl } from '../scrape.mjs'
import { hashVideo, probe } from '../hash.mjs'

test('HTML real: 20 enlaces, resolución y escapes preservados', () => {
  const series = parseSeries(readFileSync(new URL('../ejempl.html', import.meta.url), 'utf8'))
  assert.equal(series.title, 'Sayonara Lara')
  assert.equal(series.episodes.length, 20)
  assert.equal(series.episodes.filter(e => e.resolution === '720').length, 10)
  assert.equal(series.episodes[0].episode, 1)
  assert.match(series.episodes[0].url, /^https:\/\/emision\.craftervault\.com\/0:down\/Sayonara%20Lara\/%5B/)
  assert.equal(cleanUrl('https://example.com/video%20a.mkv?x=1&amp;y=2'), 'https://example.com/video%20a.mkv?x=1&y=2')
  assert.throws(() => cleanUrl('javascript:alert(1)'))
})

test('HTTP → torrent completo → descarga por piezas verificada sin peers', async t => {
  const bytes = Buffer.alloc(2 * 1024 * 1024 + 137)
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
  let fullDownloads = 0
  const server = createServer((req, res) => {
    if (req.url === '/no-range') { res.end('no range'); return }
    if (req.headers.range) {
      const [, from, to] = req.headers.range.match(/bytes=(\d+)-(\d+)/)
      const start = Number(from), end = Math.min(Number(to), bytes.length - 1)
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 })
      res.end(bytes.subarray(start, end + 1))
    } else {
      fullDownloads++
      res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Content-Length': bytes.length })
      res.end(bytes)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const temp = mkdtempSync(join(tmpdir(), 'japanpaw-test-'))
  t.after(() => { server.closeAllConnections(); server.close(); rmSync(temp, { recursive: true, force: true }) })
  const origin = `http://127.0.0.1:${server.address().port}`
  const url = origin + '/demo%20episode.mkv'
  await assert.rejects(probe(origin + '/no-range'), /Range/)
  await assert.rejects(hashVideo(url, temp, { maxBytes: 100 }), /max-bytes/)
  assert.equal(fullDownloads, 0)
  const result = await hashVideo(url, temp)
  const torrent = await parseTorrent(readFileSync(join(temp, result.torrentPath)))
  assert.equal(result.size, bytes.length)
  assert.equal(torrent.infoHash, result.infoHash)
  assert.deepEqual(torrent.urlList, [url])
  assert.deepEqual(torrent.announce, [])
  assert.equal(torrent.files.length, 1)
  assert.equal(torrent.files[0].name, 'demo episode.mkv')
  const downloaded = []
  for (let i = 0; i < torrent.pieces.length; i++) {
    const start = i * torrent.pieceLength
    const end = Math.min(start + torrent.pieceLength, bytes.length) - 1
    const response = await fetch(torrent.urlList[0], { headers: { Range: `bytes=${start}-${end}` } })
    const piece = Buffer.from(await response.arrayBuffer())
    assert.equal(createHash('sha1').update(piece).digest('hex'), torrent.pieces[i])
    downloaded.push(piece)
  }
  assert.deepEqual(Buffer.concat(downloaded), bytes)
})

test('Extensión: temporadas, Unicode, filtros, metadatos y consultas vacías', async () => {
  globalThis.TorrentSource = class {}
  const episode = { episode: 1, resolution: '1080', quality: 'WEB 1080p', fileName: 'Demo 01 x265.mkv', torrentPath: 'torrents/a.torrent', infoHash: 'a'.repeat(40), size: 42, hashedAt: '2026-09-01' }
  const catalog = [
    { title: 'Demo', episodes: [episode, { ...episode, resolution: '720', fileName: 'Demo 01 AVC.mkv' }] },
    { title: 'Demo 2', episodes: [{ ...episode, infoHash: 'b'.repeat(40) }] },
    { title: '日本語', episodes: [{ ...episode, infoHash: 'c'.repeat(40) }] }
  ]
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => catalog })
  try {
    const { default: extension } = await import('../index.js')
    assert.equal(await extension.test(), true)
    const query = { titles: ['Demo'], episode: 1, fetch: globalThis.fetch }
    const results = await extension.single(query)
    assert.equal(results.length, 2)
    assert.match(results[0].link, /\/torrents\/a.torrent$/)
    assert.equal((await extension.single({ ...query, resolution: '1080', exclusions: ['x265'] }))[0].title, 'Demo 01 AVC.mkv')
    assert.equal((await extension.single({ ...query, titles: ['Demo 2'] }))[0].hash, 'b'.repeat(40))
    assert.equal((await extension.single({ ...query, titles: ['日本語'] }))[0].hash, 'c'.repeat(40))
    assert.deepEqual(await extension.single({ ...query, titles: [''] }), [])
    assert.deepEqual(await extension.single({ ...query, titles: ['Different'] }), [])
    assert.deepEqual(await extension.single({ ...query, episode: 99 }), [])
    assert.deepEqual(await extension.batch(query), [])
    assert.deepEqual(await extension.movie(query), [])
  } finally { globalThis.fetch = originalFetch }
})
