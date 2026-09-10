import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { runIndexer, parseIndexerArgs, saveVerifiedMatches, loadVerifiedMatches } from '../indexer.mjs'

async function setup(t, count = 2) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'japanpaw-resume-'))
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'japanpaw-resume-')); fs.rmSync(dir, { recursive: true, force: true }) })
  const fixtures = []
  for (let i = 1; i <= count; i++) {
    const name = `[Group] Demo - ${String(i).padStart(2, '0')} [1080p][A000000${i}].mkv`
    const bytes = Buffer.alloc(24, i)
    const pieces = Buffer.concat([0, 8, 16].map(n => createHash('sha1').update(bytes.subarray(n, n + 8)).digest()))
    const torrent = toTorrentFile({ info: { name, length: bytes.length, 'piece length': 8, pieces } })
    const parsed = await parseTorrent(torrent)
    fixtures.push({ ep: { episode: i, resolution: '1080', fileName: name, url: `https://emision.craftervault.com/${encodeURIComponent(name)}` }, bytes, torrent, hash: parsed.infoHash, torrentUrl: `https://torrent.test/${i}.torrent` })
  }
  const catalog = [{ title: 'Demo', anilistId: 123, episodes: fixtures.map(f => f.ep) }]
  const catalogPath = join(dir, 'catalog.json')
  const original = JSON.stringify(catalog)
  fs.writeFileSync(catalogPath, original)
  const requests = []
  const response = async (url, options) => {
    const host = new URL(url).hostname
    if (host === 'emision.craftervault.com') {
      const f = fixtures.find(f => f.ep.url === url)
      const [, from, to] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number)
      return new Response(f.bytes.subarray(from, to + 1), { status: 206, headers: { 'content-range': `bytes ${from}-${to}/${f.bytes.length}` } })
    }
    if (host === 'api.anisearch.org') return Response.json(fixtures.map(f => ({ torrentName: f.ep.fileName, torrentFileUrl: f.torrentUrl, infohash: f.hash })))
    if (host.startsWith('feed.animetosho.')) return Response.json(fixtures.map(f => ({ title: f.ep.fileName, torrent_url: f.torrentUrl, info_hash: f.hash })))
    if (host === 'torrent.test') return new Response(fixtures.find(f => f.torrentUrl === url).torrent)
    throw new Error('Unexpected URL ' + url)
  }
  const options = { stateDir: dir, catalogPath, log: () => {}, concurrency: 2, maxMinutes: 1, networkOptions: { minIntervalMs: 0 }, fetchFn: async (url, opts) => { requests.push(url); return response(url, opts) } }
  return { dir, fixtures, catalog, catalogPath, original, requests, response, options }
}

test('indexer resume: concurrent workers preserve both episodes and sampled evidence', async t => {
  const f = await setup(t)
  const report = await runIndexer(f.options)
  assert.equal(report.prepared, 2)
  const eps = loadVerifiedMatches(f.dir).series['123'].episodes
  assert.deepEqual(eps.map(e => e.episode).sort(), [1, 2])
  assert.ok(eps.every(e => e.verified.evidence.pieces.length === 3 && e.verified.piecesVerified))
  assert.equal(fs.readFileSync(f.catalogPath, 'utf8'), f.original)
  assert.equal(fs.existsSync(join(f.dir, 'indexer.lock')), false)
})

test('indexer resume: repeated limit=1 advances and reuses prepared work without requests', async t => {
  const f = await setup(t)
  assert.equal((await runIndexer({ ...f.options, limit: 1 })).prepared, 1)
  f.requests.length = 0
  const next = await runIndexer({ ...f.options, limit: 1 })
  assert.equal(next.prepared, 1)
  assert.equal(next.reused, 1)
  assert.equal(loadVerifiedMatches(f.dir).series['123'].episodes.length, 2)
  assert.equal(f.requests.includes(f.fixtures[0].ep.url), false)
})

test('indexer resume: duplicate tasks share one result, not two workers', async t => {
  const f = await setup(t, 1)
  f.catalog[0].episodes.push(f.fixtures[0].ep)
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  const result = await runIndexer(f.options)
  assert.equal(result.selected, 1)
  assert.equal(result.prepared, 1)
  assert.equal(f.requests.filter(url => url === f.fixtures[0].ep.url).length, 4)
})

test('indexer resume: blocked providers stop the queue and retain Retry-After across restart', async t => {
  const f = await setup(t, 5)
  const opts = { ...f.options, concurrency: 1, fetchFn: async (url, opt) => {
    f.requests.push(url)
    if (new URL(url).hostname === 'emision.craftervault.com') return f.response(url, opt)
    return new Response('', { status: 429, headers: { 'retry-after': '120' } })
  } }
  const report = await runIndexer(opts)
  assert.equal(report.stopReason, 'providers_unavailable')
  assert.equal(report.deferred, 1)
  assert.equal(report.remaining, 4)
  assert.equal(f.requests.length, 3)
  f.requests.length = 0
  assert.equal((await runIndexer({ ...opts, retryPending: true })).stopReason, 'providers_unavailable')
  assert.equal(f.requests.length, 0)
})

test('indexer resume: repeated video 403 stops before any tracker requests and keeps host pause', async t => {
  const f = await setup(t, 5)
  const opts = { ...f.options, concurrency: 1, fetchFn: async url => { f.requests.push(url); return new Response('', { status: 403 }) } }
  const result = await runIndexer(opts)
  assert.equal(result.stopReason, 'video_host_unavailable')
  assert.equal(result.deferred, 3)
  assert.equal(result.incompatible, 0)
  assert.equal(f.requests.length, 3)
  assert.ok(f.requests.every(url => new URL(url).hostname === 'emision.craftervault.com'))
  const jobs = Object.values(JSON.parse(fs.readFileSync(join(f.dir, 'indexer-state.json'))).jobs)
  assert.ok(jobs.every(j => j.errors[0].stage === 'video_probe' && j.errors[0].status === 403))
  f.requests.length = 0
  assert.equal((await runIndexer({ ...opts, retryPending: true })).stopReason, 'video_host_unavailable')
  assert.equal(f.requests.length, 0)
})

test('indexer resume: HTML torrent is an access/format error, not incompatible or not_found', async t => {
  const f = await setup(t, 1)
  const result = await runIndexer({ ...f.options, fetchFn: async (url, opt) => new URL(url).hostname === 'torrent.test' ? new Response('<html>unavailable</html>') : f.response(url, opt) })
  assert.equal(result.deferred, 1)
  assert.equal(result.incompatible, 0)
  assert.equal(result.not_found, 0)
  const job = Object.values(JSON.parse(fs.readFileSync(join(f.dir, 'indexer-state.json'))).jobs)[0]
  assert.equal(job.errors[0].stage, 'torrent_download')
  assert.equal(job.errors[0].code, 'INVALID_RESPONSE')
})

test('indexer resume: actual SHA1 mismatch is incompatible while Range failure is deferred', async t => {
  const f = await setup(t, 1)
  const changed = { ...f.options, fetchFn: async (url, opts) => {
    if (opts.headers?.Range && opts.headers.Range !== 'bytes=0-0') {
      const res = await f.response(url, opts)
      return new Response(Buffer.alloc(8, 99), { status: 206, headers: res.headers })
    }
    return f.response(url, opts)
  } }
  assert.equal((await runIndexer(changed)).incompatible, 1)
  assert.equal(Object.values(loadVerifiedMatches(f.dir).series).flatMap(s => s.episodes).length, 0)
  const result = await runIndexer({ ...f.options, retryPending: true, fetchFn: async () => new Response('html') })
  assert.equal(result.deferred, 1)
  assert.equal(result.incompatible, 0)
})

test('indexer resume: existing unverified metadata can be sampled without searching', async t => {
  const f = await setup(t, 1), one = f.fixtures[0]
  fs.mkdirSync(join(f.dir, 'dist/torrents'), { recursive: true })
  fs.writeFileSync(join(f.dir, 'dist/torrents/known.torrent'), one.torrent)
  saveVerifiedMatches({ series: { 123: { title: 'Demo', anilistId: 123, episodes: [{ ...one.ep, directUrl: one.ep.url, infoHash: one.hash, torrentPath: 'torrents/known.torrent', verified: { piecesVerified: false } }] } } }, f.dir)
  assert.equal((await runIndexer(f.options)).prepared, 1)
  assert.equal(f.requests.length, 4)
  assert.ok(f.requests.every(url => url === one.ep.url))
})

test('indexer resume: cancellation saves partial status and releases writer lock', async t => {
  const f = await setup(t, 2), controller = new AbortController()
  const report = await runIndexer({ ...f.options, concurrency: 1, signal: controller.signal, fetchFn: async () => { controller.abort(); throw controller.signal.reason } })
  assert.equal(report.stopReason, 'interrupted')
  assert.equal(report.deferred, 1)
  assert.equal(report.remaining, 1)
  assert.equal(fs.existsSync(join(f.dir, 'indexer.lock')), false)
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(join(f.dir, 'indexer-state.json'))).jobs).length, 1)
})

test('indexer resume: failed or deferred jobs are postponed on subsequent runs unless retryPending is set', async t => {
  const f = await setup(t, 2)
  // First run fails ep 1 with 404
  const first = await runIndexer({
    ...f.options,
    limit: 1,
    fetchFn: async (url, opts) => {
      if (url === f.fixtures[0].ep.url) return new Response('Not Found', { status: 404 })
      return f.response(url, opts)
    }
  })
  assert.equal(first.deferred, 1)

  // Second run without retryPending should postpone ep 1 and advance to ep 2
  f.requests.length = 0
  const second = await runIndexer({ ...f.options, limit: 1 })
  assert.equal(second.postponed, 1)
  assert.equal(second.prepared, 1)
  assert.equal(f.requests.includes(f.fixtures[0].ep.url), false)
  assert.ok(f.requests.includes(f.fixtures[1].ep.url))

  // Third run with retryPending=true should re-attempt ep 1
  f.requests.length = 0
  const third = await runIndexer({ ...f.options, limit: 1, retryPending: true })
  assert.equal(third.postponed, 0)
  assert.equal(third.prepared, 1)
  assert.ok(f.requests.includes(f.fixtures[0].ep.url))
})

test('indexer CLI rejects misspellings and invalid budgets', () => {
  for (const args of [['--limt', '1'], ['--limit', '-1'], ['--series'], ['--max-queries', 'abc'], ['--interval-ms', '-1']]) assert.throws(() => parseIndexerArgs(args))
  assert.equal(parseIndexerArgs(['--series', 'Demo', '--concurrency', '2', '--limit', '10', '--interval-ms', '0']).intervalMs, 0)
})
