import test from 'node:test'
import assert from 'node:assert/strict'
import { createIndexerNetwork, IndexerNetworkError, retryAfterTime } from '../lib/indexer-network.js'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

test('network: Retry-After admite segundos y fechas HTTP', () => {
  const now = Date.parse('2026-09-09T12:00:00Z')
  assert.equal(retryAfterTime('45', now), now + 45000)
  assert.equal(retryAfterTime('Wed, 09 Sep 2026 12:02:00 GMT', now), now + 120000)
  assert.equal(retryAfterTime('invalid', now, 5000), now + 5000)
})

test('network: 429 pausa búsqueda y torrents del mismo host y conserva otros hosts', async () => {
  const calls = []
  let clock = Date.parse('2026-09-09T12:00:00Z')
  const network = createIndexerNetwork({
    concurrencyPerHost: 1, minIntervalMs: 0, now: () => clock,
    fetchFn: async url => {
      calls.push(url)
      return url.includes('nyaa.si') ? new Response('limited', { status: 429, headers: { 'Retry-After': '120' } }) : new Response('[]')
    }
  })
  const outcomes = await Promise.allSettled([
    network.fetch('https://nyaa.si/?q=crc'),
    network.fetch('https://nyaa.si/download/1.torrent'),
    network.fetch('https://feed.animetosho.org/json?q=crc')
  ])
  assert.equal(outcomes[0].reason.code, 'RATE_LIMITED')
  assert.equal(outcomes[0].reason.provider, 'nyaa')
  assert.equal(outcomes[0].reason.status, 429)
  assert.equal(outcomes[0].reason.retryAt, clock + 120000)
  assert.equal(outcomes[1].reason.code, 'HOST_COOLDOWN')
  assert.equal(outcomes[2].status, 'fulfilled')
  assert.equal(calls.length, 2, 'La solicitud ya en cola no debe cambiar de proxy ni reintentar')
  const persisted = JSON.parse(JSON.stringify(network.snapshot()))
  const restored = createIndexerNetwork({ initialState: persisted, now: () => clock, minIntervalMs: 0, fetchFn: async () => new Response('ok') })
  await assert.rejects(restored.fetch('https://nyaa.si/?q=next'), { code: 'HOST_COOLDOWN' })
  assert.equal(restored.snapshot().hosts['nyaa.si'].requests, 0)
  clock += 120001
  assert.equal(await (await restored.fetch('https://nyaa.si/?q=next')).text(), 'ok')
})

test('network: el slot sigue ocupado hasta recibir el cuerpo completo', async () => {
  let releaseBody
  let calls = 0
  const network = createIndexerNetwork({
    concurrencyPerHost: 1, minIntervalMs: 0,
    fetchFn: async () => {
      calls++
      if (calls === 1) return new Response(new ReadableStream({ start(controller) { releaseBody = () => { controller.enqueue(new TextEncoder().encode('first')); controller.close() } } }))
      return new Response('second')
    }
  })
  const first = network.fetch('https://files.test/1')
  const second = network.fetch('https://files.test/2')
  await delay(5)
  assert.equal(calls, 1)
  assert.equal(network.snapshot().hosts['files.test'].queued, 1)
  releaseBody()
  assert.equal(await (await first).text(), 'first')
  assert.equal(await (await second).text(), 'second')
  assert.equal(network.snapshot().hosts['files.test'].active, 0)
})

test('network: aplica concurrencia y espaciado compartidos por host', async () => {
  const starts = []
  let active = 0
  let peak = 0
  const network = createIndexerNetwork({
    concurrencyPerHost: 2, minIntervalMs: 25,
    fetchFn: async () => {
      starts.push(Date.now())
      peak = Math.max(peak, ++active)
      await delay(45)
      active--
      return new Response('ok')
    }
  })
  await Promise.all(Array.from({ length: 4 }, (_, i) => network.fetch(`https://files.test/${i}`)))
  assert.ok(peak <= 2)
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 23)
})

test('network: cancela una petición en cola sin tocar el transporte', async () => {
  const abort = new AbortController()
  let calls = 0
  const network = createIndexerNetwork({ minIntervalMs: 1000, fetchFn: async () => { calls++; return new Response('ok') } })
  await network.fetch('https://files.test/1')
  const queued = network.fetch('https://files.test/2', { signal: abort.signal })
  abort.abort()
  await assert.rejects(queued, { code: 'ABORTED' })
  assert.equal(calls, 1)
  assert.equal(network.snapshot().hosts['files.test'].queued, 0)
})

test('network: timeout cubre el cuerpo y libera el host', async () => {
  let canceled = false
  let calls = 0
  const network = createIndexerNetwork({
    minIntervalMs: 0, concurrencyPerHost: 1, timeoutMs: 25,
    fetchFn: async () => ++calls === 1 ? new Response(new ReadableStream({ cancel() { canceled = true } })) : new Response('next')
  })
  await assert.rejects(network.fetch('https://files.test/stalled'), { code: 'TIMEOUT' })
  assert.equal(canceled, true)
  assert.equal(await (await network.fetch('https://files.test/next')).text(), 'next')
})

test('network: la cancelación del trabajo corta solicitudes en curso y futuras', async () => {
  const controller = new AbortController()
  let calls = 0
  const network = createIndexerNetwork({ signal: controller.signal, minIntervalMs: 0, fetchFn: async () => { calls++; return new Promise(() => {}) } })
  const pending = network.fetch('https://files.test/stalled')
  await delay(5)
  controller.abort()
  await assert.rejects(pending, { code: 'ABORTED' })
  await assert.rejects(network.fetch('https://files.test/next'), { code: 'ABORTED' })
  assert.equal(calls, 1)
  assert.equal(network.snapshot().hosts['files.test'].active, 0)
})

test('network: limita cuerpos sin Content-Length y permite un presupuesto por pieza', async () => {
  const network = createIndexerNetwork({ minIntervalMs: 0, maxBodyBytes: 4, fetchFn: async () => new Response('12345678') })
  await assert.rejects(network.fetch('https://files.test/oversize'), { code: 'BODY_TOO_LARGE' })
  assert.equal(await (await network.fetch('https://files.test/piece', { maxBodyBytes: 8 })).text(), '12345678')
})

test('network: redirecciones respetan la pausa del servidor de destino', async () => {
  let calls = 0
  const network = createIndexerNetwork({
    minIntervalMs: 0, initialState: { 'nyaa.si': Date.now() + 60000 },
    fetchFn: async () => { calls++; return new Response(null, { status: 302, headers: { Location: 'https://nyaa.si/download/1.torrent' } }) }
  })
  await assert.rejects(network.fetch('https://mirror.test/torrent'), { code: 'HOST_COOLDOWN', provider: 'nyaa' })
  assert.equal(calls, 1)
})

test('network: fallos HTTP y transporte son distinguibles, sin reintentos ocultos', async () => {
  let calls = 0
  const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => { calls++; throw new TypeError('offline') } })
  await assert.rejects(network.fetch('https://nyaa.si/'), error => error instanceof IndexerNetworkError && error.code === 'NETWORK_ERROR' && error.url === 'https://nyaa.si/')
  assert.equal(calls, 1)
  const unavailable = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => new Response('', { status: 503 }) })
  await assert.rejects(unavailable.fetch('https://files.test/'), { code: 'SERVICE_UNAVAILABLE' })
  await assert.rejects(unavailable.fetch('https://files.test/next'), { code: 'HOST_COOLDOWN' })
})

test('network: 403 detiene inmediatamente las peticiones posteriores al host', async () => {
  let calls = 0
  const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => { calls++; return new Response('', { status: 403 }) } })
  await assert.rejects(network.fetch('https://nyaa.si/?q=one'), { code: 'HTTP_ERROR', status: 403 })
  await assert.rejects(network.fetch('https://nyaa.si/?q=two'), { code: 'HOST_COOLDOWN' })
  assert.equal(calls, 1)
})

test('network: circuito tras tres errores de red, timeout o 5xx sin contar dos veces', async () => {
  for (const transport of [
    async () => { throw new TypeError('offline') },
    async () => { throw new DOMException('timeout', 'TimeoutError') },
    async () => new Response('', { status: 502 })
  ]) {
    let calls = 0
    const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: (...args) => { calls++; return transport(...args) } })
    for (let attempt = 1; attempt <= 3; attempt++) {
      const error = await network.fetch('https://nyaa.si/?q=one').catch(error => error)
      network.noteFailure(error.url, error)
      assert.equal(network.snapshot().hosts['nyaa.si'].consecutiveFailures, attempt)
    }
    await assert.rejects(network.fetch('https://nyaa.si/?q=two'), { code: 'HOST_COOLDOWN' })
    assert.equal(calls, 3)
  }
})

test('network: respuesta correcta reinicia contador; errores de archivos individuales no bloquean host', async () => {
  const statuses = [502, 200, 502, 404, 502, 502, 200]
  const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => new Response('body', { status: statuses.shift() }) })
  for (let i = 0; i < 7; i++) await network.fetch(`https://files.test/${i}`).catch(error => assert.notEqual(error.code, 'HOST_COOLDOWN'))
  assert.equal(network.snapshot().hosts['files.test'].consecutiveFailures, 0)
  assert.equal(network.snapshot().hosts['files.test'].retryAt, 0)
})

test('network: el parser puede pausar un host que entrega challenges con HTTP200', async () => {
  const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => new Response('<html>challenge</html>') })
  await network.fetch('https://nyaa.si/?q=one')
  const failure = new IndexerNetworkError('Tabla ausente', { code: 'INVALID_RESPONSE', provider: 'nyaa', url: 'https://nyaa.si/?q=one' })
  network.noteFailure(failure.url, failure)
  assert.ok(failure.retryAt > Date.now())
  await assert.rejects(network.fetch('https://nyaa.si/?q=two'), { code: 'HOST_COOLDOWN' })
})

test('network: 403 aislado del video no pausa todo; tres fallos sí, y se restauran', async () => {
  let calls = 0
  const net = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => { calls++; return new Response('', { status: 403 }) } })
  for (let i = 0; i < 3; i++) {
    await assert.rejects(net.fetch(`https://emision.craftervault.com/${i}.mkv`), { code: 'HTTP_ERROR', status: 403 })
    if (i < 2) assert.equal(net.snapshot().hosts['emision.craftervault.com'].retryAt, 0)
  }
  await assert.rejects(net.fetch('https://emision.craftervault.com/next.mkv'), { code: 'HOST_COOLDOWN' })
  const resumed = createIndexerNetwork({ initialState: net.snapshot(), fetchFn: async () => { calls++; throw new Error('No request during cooldown') } })
  await assert.rejects(resumed.fetch('https://emision.craftervault.com/other.mkv'), { code: 'HOST_COOLDOWN' })
  assert.equal(calls, 3)
})

test('network: Range rechazado cancela el video entero antes de leerlo', async () => {
  let cancelled = false, reads = 0
  const net = createIndexerNetwork({ fetchFn: async (_url, options) => {
    assert.equal(options.requiredStatus, undefined)
    return new Response(new ReadableStream({ pull() { reads++ }, cancel() { cancelled = true } }, { highWaterMark: 0 }), { status: 200 })
  } })
  await assert.rejects(net.fetch('https://video.test/full', { requiredStatus: 206, maxBodyBytes: 1 }), { code: 'RANGE_UNAVAILABLE', status: 200 })
  assert.equal(cancelled, true)
  assert.equal(reads, 0)
})
