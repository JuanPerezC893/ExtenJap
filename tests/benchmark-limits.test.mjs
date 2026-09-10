import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseBenchmarkArgs, formatTable, runBenchmark, DEFAULT_LEVELS } from '../benchmark-limits.mjs'

test('parseBenchmarkArgs parses flags and validates arguments', () => {
  const args = [
    '--catalog', 'test-cat.json',
    '--state-dir', '/tmp/state',
    '--proxy',
    '--proxy-file', '/tmp/proxies.txt',
    '--batch-size', '50',
    '--out', 'artifacts/test',
    '--series', 'Demo Anime', '12345'
  ]
  const parsed = parseBenchmarkArgs(args)
  assert.equal(parsed.catalogPath, 'test-cat.json')
  assert.equal(parsed.stateDir, '/tmp/state')
  assert.equal(parsed.useProxy, true)
  assert.equal(parsed.proxyFile, '/tmp/proxies.txt')
  assert.equal(parsed.batchSize, 50)
  assert.equal(parsed.outDir, 'artifacts/test')
  assert.deepEqual(parsed.seriesFilter, ['Demo Anime', '12345'])

  assert.throws(() => parseBenchmarkArgs(['--batch-size', '0']), /Valor inválido para --batch-size/)
  assert.throws(() => parseBenchmarkArgs(['--batch-size', '-5']), /Valor inválido para --batch-size/)
  assert.throws(() => parseBenchmarkArgs(['--batch-size', 'abc']), /Valor inválido para --batch-size/)
  assert.throws(() => parseBenchmarkArgs(['--unknown-flag']), /Opción desconocida/)
})

test('formatTable produces formatted ASCII table', () => {
  const sampleLevels = [
    { level: 1, name: 'Conservador', concurrency: 2, intervalMs: 400, prepared: 25, elapsedSeconds: 30.0, filesPerMinute: 50.0, stopReason: 'limit', blockedHosts: [] },
    { level: 2, name: 'Moderado', concurrency: 4, intervalMs: 250, prepared: 25, elapsedSeconds: 15.0, filesPerMinute: 100.0, stopReason: 'providers_unavailable', blockedHosts: [{ host: 'feed.animetosho.xyz', status: 429 }] }
  ]
  const table = formatTable(sampleLevels)
  assert.match(table, /Nivel \| Perfil\s+\| Workers/)
  assert.match(table, /1\s+\| Conservador\s+\| 2\s+\| 400 ms\s+\| 25\s+\| 30s\s+\| 50\/min\s+\| OK/)
  assert.match(table, /2\s+\| Moderado\s+\| 4\s+\| 250 ms\s+\| 25\s+\| 15s\s+\| 100\/min\s+\| RATE_LIMITED/)
})

test('runBenchmark iterates levels, detects optimal throughput, and stops on rate limit', async () => {
  const tempDir = fs.mkdtempSync(join(tmpdir(), 'japanpaw-benchmark-test-'))
  const logs = []
  const logFn = (msg) => logs.push(msg)

  const testLevels = [
    { level: 1, name: 'Nivel 1', concurrency: 2, intervalMs: 400 },
    { level: 2, name: 'Nivel 2', concurrency: 4, intervalMs: 200 },
    { level: 3, name: 'Nivel 3', concurrency: 8, intervalMs: 50 }
  ]

  let callCount = 0
  const mockIndexer = async (opts) => {
    callCount++
    if (opts.concurrency === 2) {
      await new Promise(r => setTimeout(r, 30))
      return {
        attempted: 10,
        prepared: 10,
        reused: 0,
        deferred: 0,
        incompatible: 0,
        stopReason: 'limit',
        providers: { hosts: {} }
      }
    }
    if (opts.concurrency === 4) {
      await new Promise(r => setTimeout(r, 5))
      return {
        attempted: 10,
        prepared: 10,
        reused: 0,
        deferred: 0,
        incompatible: 0,
        stopReason: 'limit',
        providers: { hosts: {} }
      }
    }
    // Level 3 hits 429
    return {
      attempted: 3,
      prepared: 2,
      reused: 0,
      deferred: 1,
      incompatible: 0,
      stopReason: 'providers_unavailable',
      providers: { hosts: { 'api.anisearch.org': { lastStatus: 429, lastFailureCode: 'RATE_LIMITED', retryAt: Date.now() + 60000 } } }
    }
  }

  const report = await runBenchmark({
    catalogPath: 'dummy.json',
    stateDir: tempDir,
    batchSize: 10,
    levels: testLevels,
    outDir: join(tempDir, 'out'),
    log: logFn,
    cooldownBetweenLevelsMs: 0
  }, mockIndexer)

  assert.equal(callCount, 3)
  assert.equal(report.levels.length, 3)
  assert.equal(report.stopReason, 'rate_limited')
  // Level 2 should be best because it prepared 10 files and had higher concurrency/speed than level 1, while level 3 failed with rate_limited
  assert.ok(report.optimalLevel)
  assert.equal(report.optimalLevel.level, 2)

  // Verify report.json was written to disk
  const reportPath = join(tempDir, 'out', 'report.json')
  assert.ok(fs.existsSync(reportPath))
  const savedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
  assert.equal(savedReport.optimalLevel.level, 2)
  assert.equal(savedReport.stopReason, 'rate_limited')

  fs.rmSync(tempDir, { recursive: true, force: true })
})

test('runBenchmark stops cleanly on aborted signal', async () => {
  const tempDir = fs.mkdtempSync(join(tmpdir(), 'japanpaw-benchmark-abort-'))
  const controller = new AbortController()

  const mockIndexer = async () => {
    controller.abort()
    return { attempted: 5, prepared: 5, stopReason: 'limit', providers: { hosts: {} } }
  }

  const report = await runBenchmark({
    catalogPath: 'dummy.json',
    stateDir: tempDir,
    batchSize: 5,
    levels: DEFAULT_LEVELS.slice(0, 3),
    outDir: join(tempDir, 'out'),
    log: () => {},
    signal: controller.signal,
    cooldownBetweenLevelsMs: 0
  }, mockIndexer)

  assert.equal(report.stopReason, 'interrupted')
  assert.equal(report.levels.length, 1)

  fs.rmSync(tempDir, { recursive: true, force: true })
})
