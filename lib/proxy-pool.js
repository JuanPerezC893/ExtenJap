import { ProxyAgent, fetch as undiciFetch } from 'undici'
import { readFileSync, existsSync } from 'node:fs'

const PUBLIC_PROXY_SOURCES = [
  'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=all&ssl=yes&anonymity=elite',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
]

export class ProxyPool {
  constructor(options = {}) {
    this.enabled = options.enabled ?? false
    this.proxyFile = options.proxyFile ?? null
    this.timeoutMs = options.timeoutMs ?? 7000
    this.maxRetries = options.maxRetries ?? 3
    this.strictProxy = options.strictProxy ?? false
    this.candidateProxies = []
    this.workingProxies = []
    this.agents = new Map()
    this.currentIndex = 0
    this.initialized = false
  }

  getAgent(proxyUrl) {
    if (!this.agents.has(proxyUrl)) {
      this.agents.set(proxyUrl, new ProxyAgent(proxyUrl))
    }
    return this.agents.get(proxyUrl)
  }

  async loadProxies() {
    const list = new Set()

    // 1. Cargar desde archivo local si existe
    if (this.proxyFile && existsSync(this.proxyFile)) {
      try {
        const content = readFileSync(this.proxyFile, 'utf8')
        for (const line of content.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed && !trimmed.startsWith('#')) {
            const formatted = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`
            list.add(formatted)
          }
        }
        console.log(`[ProxyPool] Cargados ${list.size} proxies desde archivo ${this.proxyFile}`)
      } catch (err) {
        console.warn(`[ProxyPool] Error leyendo archivo de proxies: ${err.message}`)
      }
    }

    // 2. Si no hay suficientes, descargar de fuentes públicas
    if (list.size < 10) {
      console.log('[ProxyPool] Descargando listas públicas de proxies HTTPS/Elite...')
      for (const source of PUBLIC_PROXY_SOURCES) {
        try {
          const res = await fetch(source, { signal: AbortSignal.timeout(6000) })
          if (!res.ok) continue
          const text = await res.text()
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (trimmed && trimmed.includes(':') && !trimmed.startsWith('#')) {
              const formatted = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`
              list.add(formatted)
            }
          }
        } catch {}
        if (list.size >= 500) break
      }
      console.log(`[ProxyPool] ${list.size} proxies candidatos obtenidos.`)
    }

    this.candidateProxies = Array.from(list)
  }

  async testProxy(proxyUrl, testUrl = 'https://feed.animetosho.org/json?q=test', timeout = 4000) {
    const agent = this.getAgent(proxyUrl)
    try {
      const res = await undiciFetch(testUrl, {
        dispatcher: agent,
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      })
      return res.ok || res.status === 404
    } catch {
      return false
    }
  }

  async warmup(targetWorking = 15, maxCandidatesToTest = 100) {
    if (!this.enabled) return
    await this.loadProxies()
    if (!this.candidateProxies.length) {
      console.warn('[ProxyPool] No se encontraron proxies candidatos. Se usará conexión directa.')
      return
    }

    console.log(`[ProxyPool] Verificando rapidez de proxies (meta: ${targetWorking} proxies activos)...`)
    const candidates = this.candidateProxies.slice(0, maxCandidatesToTest)
    const batchSize = 15

    for (let i = 0; i < candidates.length && this.workingProxies.length < targetWorking; i += batchSize) {
      const chunk = candidates.slice(i, i + batchSize)
      const results = await Promise.all(
        chunk.map(async p => ({ proxy: p, ok: await this.testProxy(p) }))
      )
      for (const r of results) {
        if (r.ok && !this.workingProxies.includes(r.proxy)) {
          this.workingProxies.push(r.proxy)
        }
      }
      if (this.workingProxies.length >= targetWorking) break
    }

    console.log(`[ProxyPool] Pool activo inicializado con ${this.workingProxies.length} proxies rápidos.`)
    this.initialized = true
  }

  getNextProxy() {
    if (!this.workingProxies.length) return null
    const proxy = this.workingProxies[this.currentIndex % this.workingProxies.length]
    this.currentIndex++
    return proxy
  }

  markFailure(proxyUrl) {
    const idx = this.workingProxies.indexOf(proxyUrl)
    if (idx >= 0) {
      this.workingProxies.splice(idx, 1)
      this.agents.delete(proxyUrl)
    }
  }

  async fetch(url, options = {}, retries = this.maxRetries) {
    if (!this.enabled) {
      return fetch(url, options)
    }

    let lastError = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      const proxy = this.getNextProxy()
      if (!proxy) {
        if (this.strictProxy) {
          throw new Error('[ProxyPool] No hay proxies disponibles y strictProxy está activo.')
        }
        return fetch(url, options)
      }

      const agent = this.getAgent(proxy)
      const timeout = options.timeout ?? this.timeoutMs
      const fetchSignal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)

      try {
        const res = await undiciFetch(url, {
          ...options,
          dispatcher: agent,
          signal: fetchSignal
        })

        if (res.status === 429 || res.status === 403) {
          this.markFailure(proxy)
          continue
        }

        return res
      } catch (err) {
        this.markFailure(proxy)
        lastError = err
      }
    }

    if (!this.strictProxy) {
      return fetch(url, options)
    }
    throw lastError || new Error(`[ProxyPool] Fallaron todos los reintentos para ${url}`)
  }
}

export const defaultPool = new ProxyPool()
export default defaultPool
