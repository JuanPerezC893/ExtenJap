import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { ProxyPool } from '../lib/proxy-pool.js'

function proxyFixture(t, lines = 'proxy1:8080\nproxy2:8080\n') {
  const parent = resolve(tmpdir())
  const dir = mkdtempSync(join(parent, 'japanpaw-proxy-test-'))
  t.after(() => {
    assert.ok(resolve(dir).startsWith(`${parent}${sep}japanpaw-proxy-test-`))
    rmSync(dir, { recursive: true, force: true })
  })
  const path = join(dir, 'proxies.txt')
  writeFileSync(path, lines)
  return path
}

function mockPool(t, extra = {}) {
  const closed = []
  const requests = []
  let directRequests = 0
  const pool = new ProxyPool({
    enabled: true,
    agentFactory: url => ({ url, close: async () => { closed.push(url) } }),
    fetchImpl: async () => { directRequests++; throw new Error('Unexpected direct request') },
    proxyFetchImpl: async (url, options) => { requests.push({ url, options }); return new Response('ok') },
    ...extra
  })
  t.after(() => pool.close())
  return { pool, closed, requests, get directRequests() { return directRequests } }
}

test('disabled pool preserves native direct fetch', async () => {
  const pool = new ProxyPool({ enabled: false })
  const response = await pool.fetch('data:text/plain;charset=utf-8,hello-direct')
  assert.equal(await response.text(), 'hello-direct')
  await pool.close()
})

test('configured proxies are exclusive and lazy warmup does not use the network', async t => {
  const fixture = mockPool(t, { proxyFile: proxyFixture(t, '# private list\nproxy1:8080\nproxy1:8080\n') })
  await fixture.pool.warmup(15)
  assert.deepEqual(fixture.pool.candidateProxies, ['http://proxy1:8080/'])
  assert.deepEqual(fixture.pool.workingProxies, ['http://proxy1:8080/'])
  assert.equal(fixture.requests.length, 0)
  assert.equal(fixture.directRequests, 0)
})

test('missing and invalid proxy files fail without public downloads or direct fallback', async t => {
  const noFile = mockPool(t)
  await assert.rejects(noFile.pool.warmup(), /archivo de proxies/)
  const invalid = mockPool(t, { proxyFile: proxyFixture(t, 'socks5://secret:password@proxy:8080\n') })
  await assert.rejects(invalid.pool.warmup(), error => {
    assert.match(error.message, /línea 1/)
    assert.doesNotMatch(error.message, /secret|password/)
    return true
  })
  assert.equal(noFile.directRequests + invalid.directRequests, 0)
})

test('round-robin rotates only between explicit calls', t => {
  const { pool } = mockPool(t)
  pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080', 'http://proxy3:8080']
  assert.equal(pool.getNextProxy(), 'http://proxy1:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy2:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy3:8080')
  assert.equal(pool.getNextProxy(), 'http://proxy1:8080')
})

for (const status of [403, 429, 503]) {
  test(`HTTP ${status} reaches the scheduler intact without rotation, removal or retry`, async t => {
    let calls = 0
    let discarded = false
    const response = new Response(new ReadableStream({ cancel() { discarded = true } }), {
      status, headers: { 'Retry-After': '90' }
    })
    const fixture = mockPool(t, { maxRetries: 5, proxyFetchImpl: async () => { calls++; return response } })
    fixture.pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080']
    const received = await fixture.pool.fetch('https://feed.animetosho.org/json?q=example')
    assert.equal(received, response)
    assert.equal(received.headers.get('retry-after'), '90')
    assert.equal(calls, 1)
    assert.equal(fixture.pool.currentIndex, 1)
    assert.equal(fixture.pool.workingProxies.length, 2)
    assert.equal(discarded, false, 'caller owns the returned response body')
    assert.equal(fixture.directRequests, 0)
    await received.body.cancel()
  })
}

test('transport failure retires and closes the failed agent without direct fallback', async t => {
  let calls = 0
  const fixture = mockPool(t, {
    strictProxy: false,
    proxyFetchImpl: async () => { calls++; throw new TypeError('connection failed') }
  })
  fixture.pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080']
  await assert.rejects(fixture.pool.fetch('https://example.com/', {}, 0), /connection failed/)
  assert.equal(calls, 1)
  assert.deepEqual(fixture.pool.workingProxies, ['http://proxy2:8080'])
  assert.equal(fixture.directRequests, 0)
  await fixture.pool.close()
  assert.deepEqual(fixture.closed, ['http://proxy1:8080'])
})

test('empty enabled pool never silently switches to direct', async t => {
  const fixture = mockPool(t, { strictProxy: false })
  await assert.rejects(fixture.pool.fetch('https://example.com/'), /No hay proxies disponibles/)
  assert.equal(fixture.directRequests, 0)
})

test('caller cancellation stops immediately without retry or blaming a healthy proxy', async t => {
  const controller = new AbortController()
  let calls = 0
  const fixture = mockPool(t, {
    maxRetries: 4,
    proxyFetchImpl: async (url, { signal }) => {
      calls++
      controller.abort(new DOMException('user stopped', 'AbortError'))
      signal.throwIfAborted()
    }
  })
  fixture.pool.workingProxies = ['http://proxy1:8080', 'http://proxy2:8080']
  await assert.rejects(fixture.pool.fetch('https://example.com/', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
  assert.equal(fixture.pool.workingProxies.length, 2)
  await assert.rejects(fixture.pool.fetch('https://example.com/', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('response discarded after cancellation releases its body', async t => {
  const controller = new AbortController()
  let discarded = false
  const fixture = mockPool(t, {
    proxyFetchImpl: async () => {
      controller.abort()
      return new Response(new ReadableStream({ cancel() { discarded = true } }))
    }
  })
  fixture.pool.workingProxies = ['http://proxy1:8080']
  await assert.rejects(fixture.pool.fetch('https://example.com/', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(discarded, true)
})

test('optional warmup uses a neutral destination and cancels every discarded body', async t => {
  const requested = []
  let discarded = 0
  const fixture = mockPool(t, {
    proxyFile: proxyFixture(t), lazy: false,
    proxyFetchImpl: async url => {
      requested.push(url)
      return new Response(new ReadableStream({ cancel() { discarded++ } }))
    }
  })
  await fixture.pool.warmup(2)
  assert.deepEqual(requested, ['https://example.com/', 'https://example.com/'])
  assert.equal(discarded, 2)
  assert.equal(fixture.pool.workingProxies.length, 2)
})

test('close cancels in-flight transport and closes each agent once', async t => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const fixture = mockPool(t, {
    proxyFetchImpl: async (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      started()
    })
  })
  fixture.pool.workingProxies = ['http://proxy1:8080']
  const request = fixture.pool.fetch('https://example.com/')
  const rejected = assert.rejects(request, { name: 'AbortError' })
  await ready
  await fixture.pool.close()
  await rejected
  await fixture.pool.close()
  assert.deepEqual(fixture.closed, ['http://proxy1:8080'])
  assert.equal(fixture.pool.agents.size, 0)
  await assert.rejects(fixture.pool.fetch('https://example.com/'), /cerrado/)
})
