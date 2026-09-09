import { readFileSync } from 'node:fs'

let ProxyAgent = null
let undiciFetch = null
try {
  const undici = await import('undici')
  ProxyAgent = undici.ProxyAgent
  undiciFetch = undici.fetch
} catch {}

export class ProxyPool {
  constructor(options = {}) {
    this.enabled = options.enabled ?? false
    this.proxyFile = options.proxyFile ?? null
    this.timeoutMs = options.timeoutMs ?? 7000
    this.maxRetries = options.maxRetries ?? 0
    // Retained for callers of the previous API. Proxy mode never falls back to direct.
    this.strictProxy = options.strictProxy ?? true
    this.lazy = options.lazy ?? true
    this.testUrl = options.testUrl ?? 'https://example.com/'
    this.warmupConcurrency = Math.max(1, Math.min(3, options.warmupConcurrency ?? 2))
    this.directFetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args))
    this.proxyFetch = options.proxyFetchImpl ?? undiciFetch
    this.agentFactory = options.agentFactory ?? (ProxyAgent ? url => new ProxyAgent(url) : null)
    this.candidateProxies = []
    this.workingProxies = []
    this.agents = new Map()
    this.closingAgents = new Set()
    this.currentIndex = 0
    this.initialized = false
    this.closed = false
    this.closeController = new AbortController()
    this.closePromise = null
  }

  assertOpen() {
    if (this.closed) throw new Error('[ProxyPool] El pool está cerrado.')
  }

  getAgent(proxyUrl) {
    this.assertOpen()
    if (!this.agentFactory || !this.proxyFetch) {
      throw new Error('[ProxyPool] El modo proxy requiere undici; no se usará conexión directa.')
    }
    if (!this.agents.has(proxyUrl)) this.agents.set(proxyUrl, this.agentFactory(proxyUrl))
    return this.agents.get(proxyUrl)
  }

  async loadProxies() {
    this.assertOpen()
    if (!this.proxyFile) {
      throw new Error('[ProxyPool] Configura un archivo de proxies; no se descargan listas públicas.')
    }
    const content = readFileSync(this.proxyFile, 'utf8')
    const list = new Set()
    for (const [index, line] of content.split(/\r?\n/).entries()) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      try {
        const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
            url.pathname !== '/' || url.search || url.hash) throw new Error('invalid proxy')
        list.add(url.href)
      } catch {
        // Do not include proxy credentials in diagnostics.
        throw new Error(`[ProxyPool] Proxy inválido en la línea ${index + 1} del archivo configurado.`)
      }
    }
    this.candidateProxies = [...list]
    return this.candidateProxies
  }

  async testProxy(proxyUrl, testUrl = this.testUrl, timeout = 4000, signal) {
    signal?.throwIfAborted()
    const agent = this.getAgent(proxyUrl)
    let response
    try {
      response = await this.proxyFetch(testUrl, {
        dispatcher: agent,
        signal: AbortSignal.any([this.closeController.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])]),
        headers: { 'User-Agent': 'JapanPawIndexer/1.0' }
      })
      signal?.throwIfAborted()
      this.closeController.signal.throwIfAborted()
      return response.ok || response.status === 404
    } catch {
      signal?.throwIfAborted()
      this.closeController.signal.throwIfAborted()
      return false
    } finally {
      // Warmup responses are discarded, so release their connections immediately.
      await response?.body?.cancel().catch(() => {})
    }
  }

  async warmup(targetWorking = 15, maxCandidatesToTest = 100, options = {}) {
    this.assertOpen()
    if (!this.enabled || this.initialized) return
    const { signal, lazy = this.lazy } = options
    signal?.throwIfAborted()
    await this.loadProxies()
    if (!this.candidateProxies.length) throw new Error('[ProxyPool] El archivo no contiene proxies utilizables.')
    if (lazy) {
      // Availability is learned from actual requests; no warmup traffic to trackers.
      this.workingProxies = [...this.candidateProxies]
    } else {
      const candidates = this.candidateProxies.slice(0, maxCandidatesToTest)
      for (let i = 0; i < candidates.length && this.workingProxies.length < targetWorking; i += this.warmupConcurrency) {
        signal?.throwIfAborted()
        const results = await Promise.all(candidates.slice(i, i + this.warmupConcurrency).map(async proxy => ({
          proxy, ok: await this.testProxy(proxy, this.testUrl, this.timeoutMs, signal)
        })))
        for (const { proxy, ok } of results) {
          if (ok) this.workingProxies.push(proxy)
          else this.markFailure(proxy)
        }
      }
      if (!this.workingProxies.length) throw new Error('[ProxyPool] Ningún proxy respondió a la comprobación configurada.')
    }
    this.initialized = true
  }

  getNextProxy() {
    if (!this.workingProxies.length) return null
    return this.workingProxies[this.currentIndex++ % this.workingProxies.length]
  }

  // A file verification must keep the same route across its Range requests.
  async fetchPinned(proxy, url, options = {}) {
    this.assertOpen()
    if (!this.enabled || !proxy || !this.workingProxies.includes(proxy)) throw new Error('Proxy fijado no disponible; no se usará conexión directa.')
    const { signal, timeout = this.timeoutMs, ...rest } = options
    const combined = AbortSignal.any([this.closeController.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])])
    combined.throwIfAborted()
    return this.proxyFetch(url, { ...rest, dispatcher: this.getAgent(proxy), signal: combined })
  }

  releaseAgent(proxyUrl) {
    const agent = this.agents.get(proxyUrl)
    if (!agent) return
    this.agents.delete(proxyUrl)
    const closing = Promise.resolve().then(() => agent.close()).catch(() => agent.destroy?.()).finally(() => {
      this.closingAgents.delete(closing)
    })
    // Keep cleanup tracked even when markFailure is called without awaiting it.
    this.closingAgents.add(closing)
    closing.catch(() => {})
    return closing
  }

  markFailure(proxyUrl) {
    this.workingProxies = this.workingProxies.filter(proxy => proxy !== proxyUrl)
    return this.releaseAgent(proxyUrl)
  }

  async fetch(url, options = {}, retries = this.maxRetries) {
    this.assertOpen()
    options.signal?.throwIfAborted()
    if (!this.enabled) return this.directFetch(url, options)
    let lastError
    const attempts = Math.max(0, Math.floor(retries)) + 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      options.signal?.throwIfAborted()
      this.closeController.signal.throwIfAborted()
      const proxy = this.getNextProxy()
      if (!proxy) {
        throw lastError ?? new Error('[ProxyPool] No hay proxies disponibles; no se usará conexión directa.')
      }
      const agent = this.getAgent(proxy)
      const { timeout = this.timeoutMs, signal, ...requestOptions } = options
      const fetchSignal = AbortSignal.any([
        this.closeController.signal, AbortSignal.timeout(timeout), ...(signal ? [signal] : [])
      ])
      let response
      try {
        response = await this.proxyFetch(url, { ...requestOptions, dispatcher: agent, signal: fetchSignal })
        fetchSignal.throwIfAborted()
        // HTTP errors belong to the host scheduler, including Retry-After. They are
        // not evidence of a broken proxy and must never cause hidden extra requests.
        return response
      } catch (error) {
        await response?.body?.cancel().catch(() => {})
        signal?.throwIfAborted()
        this.closeController.signal.throwIfAborted()
        this.markFailure(proxy)
        lastError = error
      }
    }
    throw lastError ?? new Error('[ProxyPool] Falló la solicitud por proxy.')
  }

  async close() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.closeController.abort(new DOMException('Proxy pool closed', 'AbortError'))
    this.workingProxies = []
    for (const proxy of this.agents.keys()) this.releaseAgent(proxy)
    this.closePromise = Promise.allSettled([...this.closingAgents]).then(() => {})
    return this.closePromise
  }
}

export const defaultPool = new ProxyPool()
export default defaultPool
