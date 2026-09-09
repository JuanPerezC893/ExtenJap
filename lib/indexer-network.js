const DEFAULT_BODY_LIMIT = 8 * 1024 * 1024

export class IndexerNetworkError extends Error {
  constructor(message, { code = 'NETWORK_ERROR', status = null, retryAt = null, provider = null, url = null, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'IndexerNetworkError'
    this.code = code
    this.status = status
    this.retryAt = retryAt
    this.provider = provider
    this.url = url
  }
}

export function providerForUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase()
  if (hostname === 'nyaa.si' || hostname.endsWith('.nyaa.si')) return 'nyaa'
  if (hostname === 'animetosho.org' || hostname.endsWith('.animetosho.org')) return 'animetosho'
  return hostname
}

export function retryAfterTime(value, now = Date.now(), fallbackMs = 60000) {
  if (value != null && /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    return now + Number(value) * 1000
  }
  const date = value == null ? NaN : Date.parse(value)
  return Number.isFinite(date) && date > now ? date : now + fallbackMs
}

function abortedError(signal, context) {
  const timeout = signal.reason?.name === 'TimeoutError'
  return new IndexerNetworkError(timeout ? 'La solicitud superó su plazo' : 'Solicitud cancelada', {
    ...context, code: timeout ? 'TIMEOUT' : 'ABORTED', cause: signal.reason
  })
}

function abortable(promise, signal, context) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {})
    return Promise.reject(abortedError(signal, context))
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(abortedError(signal, context)) }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}

function cancelBody(response) {
  try { response?.body?.cancel()?.catch(() => {}) } catch { /* Already consumed or locked. */ }
}

/**
 * One scheduler per indexer run; every worker shares it. Slots include the entire
 * response body, which is bounded and buffered before fetch resolves. A blocked
 * host fails fast, including queued requests, so the caller can persist/defer work.
 * No transport retries or proxy changes happen here.
 */
export function createIndexerNetwork({
  fetchFn = globalThis.fetch,
  signal: runSignal,
  concurrencyPerHost = 2,
  minIntervalMs = 600,
  timeoutMs = 20000,
  maxBodyBytes = DEFAULT_BODY_LIMIT,
  defaultCooldownMs = 60000,
  failureThreshold = 3,
  hostPolicies = {},
  initialState = {},
  now = Date.now
} = {}) {
  const states = new Map()
  const handledFailures = new WeakSet()
  const savedHosts = initialState.hosts || initialState

  function stateFor(host) {
    if (states.has(host)) return states.get(host)
    const saved = savedHosts[host]
    const savedValue = typeof saved === 'object' && saved !== null ? (saved.retryAt ?? saved.cooldownUntil) : saved
    const savedTime = typeof savedValue === 'string' ? Date.parse(savedValue) : Number(savedValue)
    const policy = hostPolicies[host] || {}
    const state = {
      host, active: 0, queue: [], requests: 0, nextAllowedAt: 0, timer: null,
      cooldownUntil: Number.isFinite(savedTime) ? savedTime : 0,
      lastStatus: saved?.lastStatus ?? null,
      consecutiveFailures: Number(saved?.consecutiveFailures) || 0,
      lastFailureCode: saved?.lastFailureCode || null,
      concurrency: Math.max(1, Math.floor(policy.concurrency ?? concurrencyPerHost)),
      intervalMs: Math.max(0, policy.minIntervalMs ?? minIntervalMs)
    }
    states.set(host, state)
    return state
  }

  // Retain cooldowns for hosts that have not been requested in this session yet.
  for (const host of Object.keys(savedHosts)) stateFor(host)

  function normalizeError(error, signal, context) {
    if (error instanceof IndexerNetworkError) return error
    if (signal.aborted) return abortedError(signal, context)
    return new IndexerNetworkError(error.message || 'Error de transporte', {
      ...context, code: error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR', cause: error
    })
  }

  // Parsers can report HTTP-200 challenge pages through this same circuit. Passing
  // an error already produced by fetch is harmless; it is counted only once.
  function noteFailure(url, error) {
    if (!error || typeof error !== 'object' || handledFailures.has(error)) return error
    handledFailures.add(error)
    let state
    try { state = stateFor(new URL(url).hostname.toLowerCase()) } catch { return error }
    const immediate = ['RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'INVALID_RESPONSE'].includes(error.code) || error.status === 403
    const transient = ['NETWORK_ERROR', 'TIMEOUT'].includes(error.code) || error.status >= 500
    if (!immediate && !transient) return error
    state.consecutiveFailures++
    state.lastFailureCode = error.code
    state.lastStatus = error.status ?? null
    if (immediate || state.consecutiveFailures >= failureThreshold || error.retryAt > now()) {
      state.cooldownUntil = Math.max(state.cooldownUntil, error.retryAt || now() + defaultCooldownMs)
      error.retryAt = state.cooldownUntil
      drain(state)
    }
    return error
  }

  function drain(state) {
    if (state.timer) { clearTimeout(state.timer); state.timer = null }
    if (state.cooldownUntil > now()) {
      for (const job of state.queue.splice(0)) {
        job.cleanup()
        job.reject(new IndexerNetworkError(`Servidor ${state.host} en pausa`, {
          ...job.context, code: 'HOST_COOLDOWN', status: state.lastStatus, retryAt: state.cooldownUntil
        }))
      }
      return
    }
    while (state.active < state.concurrency && state.queue.length) {
      const delay = state.nextAllowedAt - now()
      if (delay > 0) {
        state.timer = setTimeout(() => drain(state), delay)
        return
      }
      const job = state.queue.shift()
      job.cleanup()
      if (job.signal.aborted) { job.reject(abortedError(job.signal, job.context)); continue }
      state.active++
      state.requests++
      state.nextAllowedAt = now() + state.intervalMs
      let released = false
      job.resolve(() => {
        if (released) return
        released = true
        state.active--
        drain(state)
      })
    }
  }

  function acquire(state, signal, context) {
    if (signal.aborted) return Promise.reject(abortedError(signal, context))
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        const index = state.queue.indexOf(job)
        if (index !== -1) state.queue.splice(index, 1)
        job.cleanup()
        reject(abortedError(signal, context))
        drain(state)
      }
      const job = { resolve, reject, signal, context, cleanup: () => signal.removeEventListener('abort', onAbort) }
      signal.addEventListener('abort', onAbort, { once: true })
      state.queue.push(job)
      drain(state)
    })
  }

  async function bufferResponse(response, signal, context, limit) {
    if (Number(response.headers.get('content-length')) > limit) {
      cancelBody(response)
      throw new IndexerNetworkError(`Respuesta superior a ${limit} bytes`, { ...context, code: 'BODY_TOO_LARGE', status: response.status })
    }
    if (!response.body) return response
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      while (true) {
        const { done, value } = await abortable(reader.read(), signal, context)
        if (done) break
        bytes += value.byteLength
        if (bytes > limit) throw new IndexerNetworkError(`Respuesta superior a ${limit} bytes`, { ...context, code: 'BODY_TOO_LARGE', status: response.status })
        chunks.push(value)
      }
    } catch (error) {
      reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
    const body = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    const buffered = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
    Object.defineProperty(buffered, 'url', { value: response.url || context.url })
    return buffered
  }

  async function scheduledFetch(url, options = {}) {
    const {
      signal: requestSignal,
      timeoutMs: requestTimeout = timeoutMs,
      maxBodyBytes: bodyLimit = maxBodyBytes,
      provider: requestedProvider,
      ...fetchOptions
    } = options
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new DOMException('Plazo de red agotado', 'TimeoutError')), requestTimeout)
    const signals = [controller.signal, runSignal, requestSignal].filter(Boolean)
    const signal = AbortSignal.any(signals)
    let currentUrl = String(url)
    let context = { url: currentUrl, provider: requestedProvider || null }
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        const parsed = new URL(currentUrl)
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new IndexerNetworkError('Protocolo de red no admitido', { ...context, code: 'INVALID_RESPONSE' })
        context = { url: currentUrl, provider: requestedProvider || providerForUrl(currentUrl) }
        const state = stateFor(parsed.hostname.toLowerCase())
        const release = await acquire(state, signal, context)
        let response
        try {
          const pendingResponse = Promise.resolve().then(() => {
            signal.throwIfAborted()
            return fetchFn(currentUrl, { ...fetchOptions, signal, redirect: 'manual' })
          })
          // A custom transport might ignore cancellation; dispose a late response.
          pendingResponse.then(value => { if (signal.aborted) cancelBody(value) }, () => {})
          response = await abortable(pendingResponse, signal, context)
          if (response.status === 429 || response.status === 503 || response.status === 403) {
            cancelBody(response)
            throw new IndexerNetworkError(`HTTP ${response.status} en ${state.host}; servidor en pausa`, {
              ...context, status: response.status, retryAt: retryAfterTime(response.headers.get('retry-after'), now(), defaultCooldownMs),
              code: response.status === 429 ? 'RATE_LIMITED' : response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'HTTP_ERROR'
            })
          }
          if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.get('location')) {
            cancelBody(response)
            if (fetchOptions.redirect === 'error') throw new IndexerNetworkError('Redirección no admitida', { ...context, code: 'HTTP_ERROR', status: response.status })
            const nextUrl = new URL(response.headers.get('location'), currentUrl)
            // Do not forward credentials when a download changes host.
            if (nextUrl.origin !== parsed.origin && fetchOptions.headers) {
              const headers = new Headers(fetchOptions.headers)
              headers.delete('authorization')
              headers.delete('cookie')
              fetchOptions.headers = headers
            }
            currentUrl = nextUrl.href
            continue
          }
          if (!response.ok) {
            cancelBody(response)
            if (response.status < 500) state.consecutiveFailures = 0
            throw new IndexerNetworkError(`HTTP ${response.status} en ${state.host}`, {
              ...context, code: 'HTTP_ERROR', status: response.status,
              retryAt: response.status >= 500 && response.headers.get('retry-after') ? retryAfterTime(response.headers.get('retry-after'), now(), defaultCooldownMs) : null
            })
          }
          const buffered = await bufferResponse(response, signal, context, bodyLimit)
          state.consecutiveFailures = 0
          state.lastFailureCode = null
          return buffered
        } catch (error) {
          throw noteFailure(currentUrl, normalizeError(error, signal, context))
        } finally {
          release()
        }
      }
      throw new IndexerNetworkError('Demasiadas redirecciones', { ...context, code: 'REDIRECT_LIMIT' })
    } catch (error) {
      const normalized = normalizeError(error, signal, context)
      // Queue cancellation/timeouts never reached the transport and must not be
      // counted later as another failed request by a parser/caller.
      handledFailures.add(normalized)
      throw normalized
    } finally {
      clearTimeout(timer)
    }
  }

  function snapshot() {
    return { hosts: Object.fromEntries([...states].map(([host, state]) => [host, {
      retryAt: state.cooldownUntil, cooldownUntil: state.cooldownUntil, lastStatus: state.lastStatus,
      active: state.active, queued: state.queue.length, requests: state.requests,
      consecutiveFailures: state.consecutiveFailures, lastFailureCode: state.lastFailureCode
    }])) }
  }

  return { fetch: scheduledFetch, snapshot, noteFailure }
}
