import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { appendJournal, replayJournal } from '../lib/indexer-journal.js'
import { createSourceCache } from '../indexer.mjs'
import { rankCandidates } from '../lib/matching.js'

test('journal recovers jobs, entries and pauses idempotently across a torn last append', t => {
  const dir = mkdtempSync(join(tmpdir(), 'japanpaw-journal-'))
  t.after(() => { assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep + 'japanpaw-journal-')); rmSync(dir, { recursive: true, force: true }) })
  const path = join(dir, 'journal.jsonl')
  const entry = { episode: 1, resolution: '1080', sourceFingerprint: 'fingerprint', directUrl: 'https://video.test/1.mkv', piecesVerified: true }
  const row = { key: 'key', job: { status: 'prepared', series: 'Demo', anilistId: 123 }, seriesId: '123', entry, providers: { hosts: { 'video.test': { retryAt: 12345 } } } }
  appendJournal(path, row)
  appendFileSync(path, '{"key":')
  const state = { jobs: {} }, registry = { series: {} }
  const original = readFileSync(path, 'utf8')
  assert.equal(replayJournal(path, state, registry, { repairTail: false }), 1)
  assert.equal(readFileSync(path, 'utf8'), original)
  replayJournal(path, state, registry)
  replayJournal(path, state, registry)
  assert.equal(registry.series['123'].episodes.length, 1)
  assert.deepEqual(state.providers, row.providers)
  assert.equal(state.jobs.key.status, 'prepared')
  appendJournal(path, { ...row, job: { ...row.job, attempts: 2 } })
  replayJournal(path, state, registry)
  assert.equal(state.jobs.key.attempts, 2)
  assert.equal(registry.series['123'].episodes.length, 1)
  writeFileSync(path, 'invalid complete record\n')
  assert.throws(() => replayJournal(path, state, registry))
})

test('source page cache coalesces concurrent failures, survives search activity and expires', async () => {
  let now = 0, calls = 0
  const cache = createSourceCache(() => now)
  const missing = async () => { calls++; throw Object.assign(new Error('missing'), { status: 404 }) }
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => cache('series:1', missing)))
  assert.ok(outcomes.every(o => o.status === 'rejected'))
  assert.equal(calls, 1)
  now = 599999
  await assert.rejects(cache('series:1', missing))
  assert.equal(calls, 1)
  now = 600000
  assert.equal(await cache('series:1', async () => { calls++; return 'updated' }), 'updated')
  assert.equal(calls, 2)
})

test('known single-file size mismatch does not consume download candidates; unknown sizes remain eligible', () => {
  const ep = { episode: 1, resolution: '1080', size: 1000 }
  const item = { title: 'Demo - 01 [1080p]', torrent_url: 'https://torrent.test/1' }
  const items = [{ ...item, num_files: 1, total_size: 500 }, { ...item, num_files: 1, total_size: 1000 }, item]
  const ranked = rankCandidates(items, ep)
  assert.equal(ranked.length, 2)
  assert.ok(!ranked.some(r => r.total_size === 500))
})
