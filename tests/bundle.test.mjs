import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toTorrentFile } from 'parse-torrent'
import parseTorrent from 'parse-torrent'
test('bundled worker modules load without TorrentSource globals or external imports', async t => {
  // self is a standard Web Worker global; Node does not expose it by default.
  const previousSelf = globalThis.self
  globalThis.self = globalThis
  t.after(() => { if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf })
  const code = fs.readFileSync('dist/torrent.js', 'utf8')
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const bytes = toTorrentFile({ info: { name: new TextEncoder().encode('Demo - 01.mkv'), length: 1, 'piece length': 16384, pieces: new Uint8Array(20) } })
  const parsed = await parseTorrent(bytes)
  const fetch = async url => url.includes('indexed-catalog.json') ? Response.json([{ title: 'Demo', episodes: [{ episode: 1, url: 'https://video.invalid/Demo%20-%2001.mkv', torrentPath: 'a.torrent', infoHash: parsed.infoHash }] }]) : new Response(bytes)
  const result = await module.createTorrentSource().single({ titles: ['Demo'], episode: 1, fetch })
  assert.equal(result.length, 1)
  assert.equal(result[0].hash, parsed.infoHash)
  const http = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync('dist/http.js', 'utf8')).toString('base64'))
  const webseed = await http.createHTTPSource().single({ titles: ['Demo'], episode: 1, file: { name: 'Demo - 01.mkv', index: 0 }, fetch })
  assert.equal(webseed.url, 'https://video.invalid/Demo%20-%2001.mkv')
})
