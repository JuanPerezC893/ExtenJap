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
