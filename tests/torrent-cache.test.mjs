import test from 'node:test'
import assert from 'node:assert/strict'
import { toTorrentFile } from 'parse-torrent'
import { createTorrentCache } from '../lib/torrent-cache.js'

const single = toTorrentFile({ info: { name: 'Demo - 01.mkv', length: 8, 'piece length': 8, pieces: Buffer.alloc(20) } })

test('metadata cache shares a concurrent download and bounds retained bytes', async () => {
  const cache = createTorrentCache({ maxBytes: single.byteLength })
  let calls = 0
  const download = async () => { calls++; return single }
  await Promise.all(Array.from({ length: 6 }, () => cache.load('https://test/one', download)))
  assert.equal(calls, 1)
  await cache.load('https://test/two', download)
  await cache.load('https://test/one', download)
  assert.equal(calls, 3)
})

test('metadata cache remembers unsupported batches but does not retain transport errors', async () => {
  const cache = createTorrentCache()
  const batch = toTorrentFile({ info: { name: 'Batch', files: [{ length: 8, path: ['1.mkv'] }, { length: 8, path: ['2.mkv'] }], 'piece length': 8, pieces: Buffer.alloc(40) } })
  const result = await Promise.allSettled([1, 2, 3].map(() => cache.load('https://test/batch', async () => batch)))
  assert.ok(result.every(r => r.reason.code === 'UNSUPPORTED_TORRENT'))
  assert.equal(cache.rejected('https://test/batch'), true)
  assert.equal(cache.stats.downloads, 1)
  await assert.rejects(cache.load('https://test/single', async () => { throw new Error('temporary') }))
  assert.deepEqual(await cache.load('https://test/single', async () => single), single)
})
