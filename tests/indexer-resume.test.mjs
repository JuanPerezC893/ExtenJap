import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { runIndexer, boundedQueries, parseIndexerArgs, saveVerifiedMatches, loadVerifiedMatches } from '../indexer.mjs'
import { rankCandidates } from '../lib/matching.js'

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

test('indexer resume: reclaims stale indexer.lock when previous process is dead', async t => {
  const f = await setup(t)
  const lockPath = join(f.dir, 'indexer.lock')
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 99999999, startedAt: new Date(Date.now() - 3600000).toISOString() }))
  assert.ok(fs.existsSync(lockPath))

  const messages = []
  const report = await runIndexer({ ...f.options, limit: 1, log: msg => messages.push(msg) })
  assert.equal(report.prepared, 1)
  assert.ok(messages.some(m => m.includes('Se detectó un bloqueo huérfano')))
  assert.equal(fs.existsSync(lockPath), false)
})

test('indexer resume: active process rejects concurrent execution unless forceLock is used', async t => {
  const f = await setup(t)
  const lockPath = join(f.dir, 'indexer.lock')
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  assert.ok(fs.existsSync(lockPath))

  await assert.rejects(
    () => runIndexer({ ...f.options, limit: 1 }),
    /Ya existe .*\(proceso activo PID/
  )

  const report = await runIndexer({ ...f.options, limit: 1, forceLock: true })
  assert.equal(report.prepared, 1)
  assert.equal(fs.existsSync(lockPath), false)
})

test('matching: rankCandidates prioritizes candidates matching group, source and siblings over conflicting variants', () => {
  const ep = {
    episode: 1,
    resolution: '1080',
    fileName: 'Jack-of-All-Trades.Party.of.None.S01E01.The.Jack-of-All-Trades.Becomes.a.Swordsman.Once.More.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv'
  }
  const siblings = [
    {
      episode: 2,
      fileName: 'Jack-of-All-Trades.Party.of.None.S01E02.No.Going.Back.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv'
    }
  ]
  const items = [
    { title: '[ToonsHub] Jack-of-All-Trades Party of None S01E01 1080p BILI WEB-DL AAC2.0 H.265', torrent_url: 'https://test/bili.torrent' },
    { title: '[ToonsHub] Jack-of-All-Trades Party of None S01E01 1080p CR WEB-DL DUAL AAC2.0 H.264', torrent_url: 'https://test/dual.torrent' },
    { title: '[ToonsHub] Jack-of-All-Trades Party of None S01E01 1080p CR WEB-DL AAC2.0 H.264 (Multi-Subs)', torrent_url: 'https://test/exact.torrent' },
    { title: '[ToonsHub] Jack-of-All-Trades Party of None S01E01 1080p AMZN WEB-DL DDP2.0 H.264', torrent_url: 'https://test/amzn.torrent' }
  ]

  const ranked = rankCandidates(items, ep, siblings)
  assert.equal(ranked[0].torrent_url, 'https://test/exact.torrent', 'La release exacta de Crunchyroll debe quedar en posición #1')
  assert.equal(ranked[ranked.length - 1].torrent_url, 'https://test/bili.torrent', 'La variante incompatible de Bilibili debe quedar al final')
})

test('indexer resume: sibling rescue pass re-attempts and rescues previously incompatible episodes', async t => {
  const f = await setup(t, 2)
  let ep1Attempts = 0
  const report = await runIndexer({
    ...f.options,
    fetchFn: async (url, opts) => {
      if (url === f.fixtures[0].ep.url) {
        ep1Attempts++
        if (ep1Attempts === 2) {
          const res = await f.response(url, opts)
          const data = new Uint8Array(await res.arrayBuffer())
          data[0] ^= 0xff
          return new Response(data, { status: 206, headers: res.headers })
        }
      }
      return f.response(url, opts)
    }
  })
  assert.equal(report.prepared, 2)
  assert.equal(report.incompatible, 0)
})

test('indexer CLI rejects misspellings and invalid budgets', () => {
  for (const args of [['--limt', '1'], ['--limit', '-1'], ['--series'], ['--max-queries', 'abc'], ['--interval-ms', '-1']]) assert.throws(() => parseIndexerArgs(args))
  assert.equal(parseIndexerArgs(['--series', 'Demo', '--concurrency', '2', '--limit', '10', '--interval-ms', '0']).intervalMs, 0)
  assert.equal(parseIndexerArgs(['--force-lock']).forceLock, true)
})




test('rescue query budget actually uses verified siblings instead of repeating CRC', () => {
  const ep = { episode: 2, fileName: '[Group] Demo - 02 [1080p][A0000002].mkv' }
  const siblings = [{ episode: 1, fileName: '[Group] Demo - 01 [1080p][A0000001].mkv' }]
  const result = boundedQueries({ title: 'Demo' }, ep, 2, siblings, true)
  assert.equal(result.plans.length, 2)
  assert.ok(result.plans.every(p => p.query.includes('02') && !p.query.includes('A0000002')))
})

test('resume repairs a missing torrent instead of trusting registry flags', async t => {
  const f = await setup(t, 1)
  await runIndexer(f.options)
  const entry = loadVerifiedMatches(f.dir).series['123'].episodes[0]
  fs.unlinkSync(join(f.dir, 'dist', entry.torrentPath))
  const report = await runIndexer(f.options)
  assert.equal(report.reused, 0)
  assert.equal(report.prepared, 1)
  assert.ok(fs.existsSync(join(f.dir, 'dist', entry.torrentPath)))
})

test('expired deferred jobs retry automatically; future pauses survive force-lock', async t => {
  const f = await setup(t, 1)
  await runIndexer({ ...f.options, fetchFn: async () => { throw new Error('offline') } })
  const statePath = join(f.dir, 'indexer-state.json')
  const state = JSON.parse(fs.readFileSync(statePath))
  Object.values(state.jobs)[0].retryAt = Date.now() - 1
  state.providers = {}
  fs.writeFileSync(statePath, JSON.stringify(state))
  assert.equal((await runIndexer(f.options)).prepared, 1)
  const another = await setup(t, 1)
  fs.writeFileSync(join(another.dir, 'indexer-state.json'), JSON.stringify({ version: 1, jobs: {}, providers: { hosts: { 'emision.craftervault.com': { retryAt: Date.now() + 60000 } } } }))
  assert.equal((await runIndexer({ ...another.options, forceLock: true })).stopReason, 'video_host_unavailable')
  assert.equal(another.requests.length, 0)
})

test('404 refreshes exact published file, verifies pieces and reuses corrected URL', async t => {
  const f = await setup(t, 1)
  f.catalog[0].sourceV = 7400
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  const originalUrl = f.fixtures[0].ep.url
  const newUrl = originalUrl.replace('.com/', '.com/archive/')
  const html = '<h2>Demo</h2><div id="tab_content_1" class="tab_content"><img src="Publicos-Paste.png"><a href="' + newUrl + '">Episodio 1</a></div>'
  const opts = { ...f.options, fetchFn: async (url, options) => {
    if (url === originalUrl) return new Response('', { status: 404 })
    if (url.startsWith('https://paste.japan-paw.net/')) return new Response(html)
    return f.response(url === newUrl ? originalUrl : url, options)
  } }
  const report = await runIndexer(opts)
  assert.equal(report.prepared, 1)
  const entry = loadVerifiedMatches(f.dir).series['123'].episodes[0]
  assert.equal(entry.directUrl, newUrl)
  assert.equal(entry.sourceUrl, originalUrl)
  assert.equal(entry.verified.piecesVerified, true)
  const parsed = await parseTorrent(fs.readFileSync(join(f.dir, 'dist', entry.torrentPath)))
  assert.deepEqual(parsed.urlList, [newUrl])
  assert.equal((await runIndexer({ ...opts, fetchFn: () => { throw new Error('must reuse') } })).reused, 1)
})


test('rescue performs a new sibling query and respects the total attempt budget', async t => {
  for (const limit of [2, 3]) {
    const f = await setup(t, 2)
    f.catalog[0].title = 'Different catalog title'
    fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
    const queries = []
    const report = await runIndexer({ ...f.options, concurrency: 1, limit, fetchFn: async (url, opts) => {
      const u = new URL(url)
      if (u.hostname === 'api.anisearch.org' || u.hostname.startsWith('feed.animetosho.')) {
        const query = decodeURIComponent(u.search)
        queries.push(query)
        if (!query.includes('A0000002') && !query.includes('Group] Demo - 01')) return Response.json([])
      }
      return f.response(url, opts)
    } })
    assert.equal(report.prepared, limit === 2 ? 1 : 2)
    assert.equal(report.rescueAttempted, limit === 2 ? 0 : 1)
    assert.ok(report.attempted + report.rescueAttempted <= limit)
    if (limit === 3) assert.ok(queries.some(q => q.includes('Group] Demo - 01')))
  }
})

test('404 refresh never substitutes a different release', async t => {
  const f = await setup(t, 1)
  f.catalog[0].sourceV = 7400
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  const report = await runIndexer({ ...f.options, fetchFn: async url => {
    if (url.startsWith('https://paste.japan-paw.net/')) return new Response('<h2>Demo</h2><div id="tab_content_1" class="tab_content"><img src="Publicos-Paste.png"><a href="https://emision.craftervault.com/Other-01-1080p.mkv">Episodio 1</a></div>')
    return new Response('', { status: 404 })
  } })
  assert.equal(report.deferred, 1)
  assert.equal(report.prepared, 0)
  assert.equal(Object.values(JSON.parse(fs.readFileSync(join(f.dir, 'indexer-state.json'))).jobs)[0].reason, 'SOURCE_UNAVAILABLE')
})


test('paused torrent host does not exhaust candidate budget before an available source', async t => {
  const f = await setup(t, 1)
  fs.writeFileSync(join(f.dir, 'indexer-state.json'), JSON.stringify({ version: 1, jobs: {}, providers: { hosts: { 'nyaa.si': { retryAt: Date.now() + 60000, lastStatus: 429 } } } }))
  const item = f.fixtures[0]
  const report = await runIndexer({ ...f.options, maxCandidates: 1, fetchFn: async (url, opts) => {
    if (new URL(url).hostname === 'api.anisearch.org') return Response.json([
      ...[1, 2, 3, 4].map(i => ({ torrentName: item.ep.fileName, torrentFileUrl: 'https://nyaa.si/download/' + i + '.torrent', infohash: item.hash })),
      { torrentName: item.ep.fileName, torrentFileUrl: item.torrentUrl, infohash: item.hash }
    ])
    assert.notEqual(new URL(url).hostname, 'nyaa.si')
    return f.response(url, opts)
  } })
  assert.equal(report.prepared, 1)
  assert.equal(report.deferred, 0)
})


test('pending torrent survives a piece timeout and resumes while search providers are paused', async t => {
  const f = await setup(t, 1)
  const first = await runIndexer({ ...f.options, pieceTimeoutMs: 20, fetchFn: async (url, opts) => {
    if (url === f.fixtures[0].ep.url && opts.headers.Range !== 'bytes=0-0') return new Promise(() => {})
    return f.response(url, opts)
  } })
  assert.equal(first.deferred, 1)
  const pending = fs.readdirSync(join(f.dir, 'pending'))
  assert.equal(pending.length, 1)
  const statePath = join(f.dir, 'indexer-state.json')
  const state = JSON.parse(fs.readFileSync(statePath))
  Object.values(state.jobs)[0].retryAt = Date.now() - 1
  for (const host of ['api.anisearch.org', 'feed.animetosho.xyz']) state.providers.hosts[host] = { retryAt: Date.now() + 60000 }
  fs.writeFileSync(statePath, JSON.stringify(state))
  const next = await runIndexer({ ...f.options, fetchFn: async (url, opts) => {
    assert.equal(url, f.fixtures[0].ep.url, 'No buscar ni volver a descargar el torrent')
    return f.response(url, opts)
  } })
  assert.equal(next.prepared, 1)
  assert.equal(fs.readdirSync(join(f.dir, 'pending')).length, 0)
  assert.equal(loadVerifiedMatches(f.dir).series['123'].episodes[0].verified.matchedBy, 'pending-torrent')
})

test('twelve discovery workers never perform more than two video verifications at once', async t => {
  const f = await setup(t, 12)
  let active = 0, peak = 0
  const report = await runIndexer({ ...f.options, concurrency: 12, videoConcurrency: 2, fetchFn: async (url, opts) => {
    const piece = opts.headers?.Range && opts.headers.Range !== 'bytes=0-0'
    if (piece) {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    try { return await f.response(url, opts) } finally { if (piece) active-- }
  } })
  assert.equal(report.prepared, 12)
  assert.equal(peak, 2)
})

test('one video host in cooldown does not stop a healthy host', async t => {
  const f = await setup(t, 2)
  const original = f.fixtures[1].ep.url
  const other = original.replace('emision.', 'anime.')
  f.catalog[0].episodes[1] = { ...f.fixtures[1].ep, url: other }
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  fs.writeFileSync(join(f.dir, 'indexer-state.json'), JSON.stringify({ version: 1, jobs: {}, providers: { hosts: { 'emision.craftervault.com': { retryAt: Date.now() + 60000 } } } }))
  const report = await runIndexer({ ...f.options, concurrency: 1, fetchFn: (url, opts) => f.response(url === other ? original : url, opts) })
  assert.equal(report.prepared, 1)
  assert.deepEqual(report.pausedVideoHosts, ['emision.craftervault.com'])
  assert.equal(report.remaining, 1)
})

test('video size mismatch rejects torrent before downloading any sampled pieces', async t => {
  const f = await setup(t, 1)
  const report = await runIndexer({ ...f.options, fetchFn: async (url, opts) => {
    if (url === f.fixtures[0].ep.url) {
      assert.equal(opts.headers.Range, 'bytes=0-0')
      return new Response(new Uint8Array(1), { status: 206, headers: { 'content-range': 'bytes 0-0/1000' } })
    }
    return f.response(url, opts)
  } })
  assert.equal(report.incompatible, 1)
  assert.equal(report.prepared, 0)
})


test('video path control verifies known pairs without modifying the registry or searching', async t => {
  const f = await setup(t, 1)
  await runIndexer(f.options)
  const registry = fs.readFileSync(join(f.dir, 'verified-matches.json'), 'utf8')
  const { checkVideoPath } = await import('../check-video-path.mjs')
  const result = await checkVideoPath({ stateDir: f.dir, limit: 1, log: () => {}, fetchFn: (url, opts) => {
    assert.equal(url, f.fixtures[0].ep.url)
    return f.response(url, opts)
  } })
  assert.equal(result.ok, true)
  assert.equal(result.passed, 1)
  assert.equal(result.results[0].evidence.pieces.length, 3)
  assert.equal(fs.readFileSync(join(f.dir, 'verified-matches.json'), 'utf8'), registry)
})


test('three unavailable probes pause a series, admit healthy work and rotate after expiry', async t => {
  const f = await setup(t, 7)
  f.catalog = [{ ...f.catalog[0], episodes: f.fixtures.slice(0, 6).map(x => x.ep) }, { title: 'Other', anilistId: 456, episodes: [f.fixtures[6].ep] }]
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  let missingCalls = 0
  const report = await runIndexer({ ...f.options, concurrency: 12, fetchFn: async (url, opts) => {
    if (f.fixtures.slice(0, 6).some(x => x.ep.url === url)) { missingCalls++; return new Response('', { status: 404 }) }
    return f.response(url, opts)
  } })
  assert.equal(missingCalls, 3)
  assert.equal(report.prepared, 1)
  assert.equal(report.deferred, 3)
  assert.equal(report.availabilitySkipped, 3)
  assert.equal(report.attempted, 4)
  const path = join(f.dir, 'indexer-state.json')
  const state = JSON.parse(fs.readFileSync(path))
  for (const health of Object.values(state.availability)) if (health.retryAt) health.retryAt = Date.now() - 1
  for (const job of Object.values(state.jobs)) if (job.retryAt) job.retryAt = Date.now() - 1
  fs.writeFileSync(path, JSON.stringify(state))
  const calls = []
  const next = await runIndexer({ ...f.options, concurrency: 1, fetchFn: async (url, opts) => { calls.push(url); return f.response(url, opts) } })
  assert.equal(calls[0], f.fixtures[3].ep.url)
  assert.equal(next.prepared, 6)
  assert.equal(next.reused, 1)
})


test('bounded search reaches a file season code and shared series lookup without repeating group variants', () => {
  const plans = boundedQueries({ title: 'Bakuman S2', aliases: ['Bakuman. 2nd Season'] }, { episode: 1, resolution: '1080', quality: '[SphinxAnime] [BD 1080p]', fileName: 'Bakuman (2010) S02E01.mkv' }, 4).plans
  assert.equal(plans.length, 4)
  assert.ok(plans.some(p => p.query === 'Bakuman S02E01'))
  assert.equal(plans.filter(p => p.query === 'Bakuman').length, 2)
  assert.ok(plans.some(p => p.query.includes('2nd Season')))
})

test('one shared broad lookup prepares two episodes when all episode queries are empty', async t => {
  const f = await setup(t, 2)
  for (const item of f.fixtures) item.ep.fileName = item.ep.fileName.replace(/\[A000000\d\]/, '')
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  let broadCalls = 0
  const report = await runIndexer({ ...f.options, fetchFn: async (url, opts) => {
    const u = new URL(url)
    if (u.hostname === 'api.anisearch.org' || u.hostname.startsWith('feed.animetosho.')) {
      const q = u.searchParams.get('q') || u.searchParams.get('name')
      if (q !== 'Demo' && q !== 'ilike.*Demo*') return Response.json([])
      broadCalls++
    }
    return f.response(url, opts)
  } })
  assert.equal(report.prepared, 2)
  assert.equal(broadCalls, 1)
  const jobs = Object.values(JSON.parse(fs.readFileSync(join(f.dir, 'indexer-state.json'))).jobs)
  assert.ok(jobs.every(j => j.searchTrace.some(q => q.strategy === 'series_broad' && q.returned === 2)))
})

test('old not-found jobs use the new plan once and persist an explicit empty-result diagnosis', async t => {
  const f = await setup(t, 1)
  const opts = { ...f.options, fetchFn: async (url, options) => new URL(url).hostname === 'emision.craftervault.com' ? f.response(url, options) : Response.json([]) }
  await runIndexer(opts)
  const path = join(f.dir, 'indexer-state.json')
  const state = JSON.parse(fs.readFileSync(path))
  delete Object.values(state.jobs)[0].searchPlanVersion
  fs.writeFileSync(path, JSON.stringify(state))
  assert.equal((await runIndexer(opts)).not_found, 1)
  const job = Object.values(JSON.parse(fs.readFileSync(path)).jobs)[0]
  assert.equal(job.searchDiagnosis, 'EMPTY_RESULTS')
  assert.equal(job.searchTrace.length, 4)
  assert.equal((await runIndexer(opts)).postponed, 1)
})


test('one broad provider cannot spend all candidate downloads before the next provider', async t => {
  const f = await setup(t, 1)
  f.fixtures[0].ep.fileName = f.fixtures[0].ep.fileName.replace(/\[A000000\d\]/, '')
  f.fixtures[0].ep.url = 'https://emision.craftervault.com/' + encodeURIComponent(f.fixtures[0].ep.fileName)
  fs.writeFileSync(f.catalogPath, JSON.stringify(f.catalog))
  const bad = toTorrentFile({ info: { name: f.fixtures[0].ep.fileName, length: 24, 'piece length': 8, pieces: Buffer.alloc(60) } })
  let badDownloads = 0
  const report = await runIndexer({ ...f.options, fetchFn: async (url, opts) => {
    const u = new URL(url)
    if (u.hostname === 'bad.test') { badDownloads++; return new Response(bad) }
    if (u.hostname === 'api.anisearch.org') return Response.json([1, 2, 3, 4].map(i => ({ torrentName: f.fixtures[0].ep.fileName, torrentFileUrl: 'https://bad.test/' + i })))
    if (u.hostname.startsWith('feed.animetosho.') && u.searchParams.get('q') !== 'Demo') return Response.json([])
    return f.response(url, opts)
  } })
  assert.equal(report.prepared, 1, fs.readFileSync(join(f.dir, 'indexer-state.json'), 'utf8'))
  assert.equal(badDownloads, 2)
})


test('persistent metadata cooldown stops admission after three failed files', async t => {
  const f = await setup(t, 8)
  let nyaaCalls = 0
  const report = await runIndexer({ ...f.options, concurrency: 1, fetchFn: async (url, opts) => {
    const host = new URL(url).hostname
    if (host === 'nyaa.si') { nyaaCalls++; return new Response('', { status: 429, headers: { 'retry-after': '600' } }) }
    if (host === 'api.anisearch.org') return Response.json(f.fixtures.map((x, i) => ({ torrentName: x.ep.fileName, torrentFileUrl: 'https://nyaa.si/download/' + i + '.torrent', infohash: x.hash })))
    if (host.startsWith('feed.animetosho.')) return Response.json([])
    return f.response(url, opts)
  } })
  assert.equal(report.stopReason, 'metadata_unavailable')
  assert.equal(report.attempted, 3)
  assert.equal(report.deferred, 3)
  assert.equal(report.remaining, 5)
  assert.equal(nyaaCalls, 1)
})
