import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProxyPool } from './lib/proxy-pool.js'
import { directUrl } from './lib/direct-url.js'
import { fileName, normalize } from './lib/matching.js'
import { parseSeries } from './scrape.mjs'
import { isMain } from './lib/io.mjs'
import { createMetadata } from './lib/stremio-metadata.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
const allowed = value => { try { const u = new URL(value); return u.protocol === 'https:' && (u.hostname === 'craftervault.com' || u.hostname.endsWith('.craftervault.com')) } catch { return false } }
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
export async function createAddon({ catalog, port = 8790, fetchFn, metadata, proxyFile = 'proxies.txt', useProxy = true, log = console.log } = {}) {
  const pool = fetchFn ? null : new ProxyPool({ enabled: useProxy, proxyFile })
  if (pool) await pool.warmup()
  const request = fetchFn || ((url, opts) => pool.fetch(url, { ...opts, timeout: 86_400_000 }))
  metadata ??= createMetadata({
    fetchFn: fetchFn || fetch,
    offlineDbPath: fetchFn ? undefined : 'artifacts/anime-offline-database.json',
    path: fetchFn ? undefined : 'artifacts/stremio-metadata.json',
    log
  })
  const series = new Map(), files = new Map(), refreshes = new Map(), active = new Set()
  for (const row of catalog) {
    const id = `jp:${row.sourceV ?? digest(row.title)}`
    const videos = new Map()
    for (const ep of row.episodes || []) {
      const url = directUrl(ep.url)
      if (!allowed(url) || !Number.isFinite(Number(ep.episode))) continue
      const key = digest(id + '\n' + url)
      files.set(key, { ep, row, url })
      const episode = Number(ep.episode)
      if (!videos.has(episode)) videos.set(episode, [])
      if (!videos.get(episode).includes(key)) videos.get(episode).push(key)
    }
    if (videos.size) series.set(id, { row, videos })
  }
  const manifest = { id: 'local.japanpaw.http', version: '0.1.0', name: 'Japan-Paw Directo', description: 'Catálogo Japan-Paw por HTTP, sin preindexación. Requiere el servicio local encendido.', types: ['series'], resources: ['catalog', { name: 'meta', types: ['series'], idPrefixes: ['jp:'] }, { name: 'stream', types: ['series'], idPrefixes: ['jp:'] }], catalogs: [{ type: 'series', id: 'japanpaw', name: 'Japan-Paw', extra: [{ name: 'search' }, { name: 'skip' }] }] }
  let base
  const preview = ([id, s]) => ({ id, type: 'series', name: s.row.title, description: (s.row.aliases || []).join(' · '), ...metadata?.get(s.row.anilistId, s.row.title) })
  const refresh = async (entry, signal) => {
    if (!Number.isInteger(Number(entry.row.sourceV))) return
    const key = entry.row.sourceV
    let cached = refreshes.get(key)
    if (!cached || cached.expires < Date.now()) {
      // Keep a short negative cache so repeated player requests do not rescrape.
      cached = { expires: Date.now() + 300_000, promise: (async () => {
        const r = await request(`https://paste.japan-paw.net/?v=${Number(key)}`, { signal, headers: { 'User-Agent': UA } })
        if (!r.ok) { await r.body?.cancel(); return [] }
        const chunks = []; let size = 0
        for await (const chunk of r.body) { size += chunk.length; if (size > 4 * 1024 * 1024) throw new Error('Página demasiado grande'); chunks.push(chunk) }
        return parseSeries(Buffer.concat(chunks).toString())?.episodes || []
      })() }
      refreshes.set(key, cached)
      if (refreshes.size > 100) refreshes.delete(refreshes.keys().next().value)
    }
    const matches = (await cached.promise).filter(e => fileName(e) === fileName(entry.ep) && Number(e.episode) === Number(entry.ep.episode))
    const urls = [...new Set(matches.map(e => directUrl(e.url)).filter(allowed))]
    if (urls.length === 1) entry.url = urls[0]
  }
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, Content-Type')
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
    res.setHeader('Access-Control-Allow-Private-Network', 'true')
    res.setHeader('Cache-Control', 'no-store')
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data)) }
    let controller, timer
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'Método no permitido' })
      const url = new URL(req.url, base)
      if (url.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(`<h1>Japan-Paw Directo</h1><p>${series.size} series disponibles. Servicio local activo.</p><h3>Stremio</h3><p><a href="stremio://127.0.0.1:${server.address().port}/manifest.json">Instalar en Stremio</a></p><code>${base}/manifest.json</code><h3>Seanime</h3><p>URL de la extensión para Seanime:</p><code>${base}/seanime/manifest.json</code>`) }
      if (url.pathname === '/manifest.json') return json(200, manifest)
      if (url.pathname === '/seanime/manifest.json') {
        return json(200, {
          id: 'japanpaw-direct',
          name: 'Japan-Paw Directo',
          description: 'Streaming directo por HTTP para Japan-Paw mediante servicio local sin torrents.',
          manifestURI: `${base}/seanime/manifest.json`,
          version: '1.0.0',
          author: 'JuanPerezC893',
          type: 'onlinestream-provider',
          language: 'javascript',
          lang: 'es',
          payloadURI: `${base}/seanime/provider.js`
        })
      }
      if (url.pathname === '/seanime/marketplace.json') {
        return json(200, [{
          id: 'japanpaw-direct',
          name: 'Japan-Paw Directo',
          description: 'Streaming directo por HTTP para Japan-Paw mediante servicio local sin torrents.',
          manifestURI: `${base}/seanime/manifest.json`,
          version: '1.0.0',
          author: 'JuanPerezC893',
          type: 'onlinestream-provider',
          language: 'javascript',
          lang: 'es',
          payloadURI: `${base}/seanime/provider.js`
        }])
      }
      if (url.pathname === '/seanime/provider.js') {
        try {
          const js = readFileSync('seanime-extension/provider.js', 'utf8')
          res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' })
          return res.end(js)
        } catch {
          return json(404, { error: 'Archivo no encontrado' })
        }
      }
      if (url.pathname === '/seanime/search') {
        const q = normalize(url.searchParams.get('q') || '')
        const anilistId = Number(url.searchParams.get('anilistId') || 0)
        let matches = []
        if (Number.isSafeInteger(anilistId) && anilistId > 0) {
          matches = [...series].filter(([, s]) => Number(s.row.anilistId) === anilistId)
        }
        if (!matches.length && q) {
          matches = [...series].filter(([, s]) => [s.row.title, ...(s.row.aliases || [])].some(t => normalize(t).includes(q)))
        }
        return json(200, {
          results: matches.slice(0, 25).map(([id, s]) => ({
            id,
            title: s.row.title,
            url: `${base}/seanime/episodes?id=${encodeURIComponent(id)}`,
            subOrDub: 'sub'
          }))
        })
      }
      if (url.pathname === '/seanime/episodes') {
        const id = url.searchParams.get('id')
        const s = series.get(id)
        if (!s) return json(404, { error: 'Serie no encontrada', episodes: [] })
        const episodes = [...s.videos.keys()].sort((a, b) => a - b).map(ep => ({
          id: `${id}:${ep}`,
          number: ep,
          title: `Episodio ${ep}`,
          url: `${base}/seanime/source?id=${encodeURIComponent(`${id}:${ep}`)}`
        }))
        return json(200, { episodes })
      }
      if (url.pathname === '/seanime/source') {
        const fullId = url.searchParams.get('id') || ''
        const server = url.searchParams.get('server') || 'Japan-Paw'
        const m = fullId.match(/^(jp:[^:]+):(\d+(?:\.\d+)?)$/)
        const s = m && series.get(m[1])
        const keys = s?.videos.get(Number(m[2])) || []
        if (!keys.length) return json(404, { error: 'Episodio no encontrado', videoSources: [] })
        let sources = keys.map(key => {
          const { ep } = files.get(key)
          return {
            url: `${base}/play/${key}`,
            quality: ep.resolution ? `${ep.resolution}p` : 'auto',
            type: 'mp4',
            subtitles: []
          }
        })
        if (server.includes('720')) {
          sources.sort((a, b) => (b.quality === '720p' ? 1 : 0) - (a.quality === '720p' ? 1 : 0))
        } else {
          sources.sort((a, b) => (b.quality === '1080p' ? 1 : 0) - (a.quality === '1080p' ? 1 : 0))
        }
        return json(200, {
          server: server || 'Japan-Paw',
          headers: {},
          videoSources: sources
        })
      }
      const route = url.pathname.match(/^\/(catalog|meta|stream)\/series\/([^/]+?)(?:\/([^/]+))?\.json$/)
      if (route) {
        const [, resource, rawId, extra] = route, id = decodeURIComponent(rawId)
        if (resource === 'catalog') {
          if (id !== 'japanpaw') return json(404, { metas: [] })
          const args = new URLSearchParams(extra || url.search), search = normalize(args.get('search') || '')
          const skip = Number(args.get('skip') || 0)
          if (!Number.isSafeInteger(skip) || skip < 0) return json(400, { error: 'skip inválido' })
          const page = [...series].filter(([, s]) => !search || [s.row.title, ...(s.row.aliases || [])].some(t => normalize(t).includes(search))).slice(skip, skip + 100)
          await metadata?.ensure(page.map(([, s]) => s.row))
          return json(200, { metas: page.map(preview) })
        }
        if (resource === 'meta') {
          const s = series.get(id)
          if (!s) return json(404, { meta: null })
          await metadata?.ensure([s.row])
          return json(200, { meta: { ...preview([id, s]), videos: [...s.videos.keys()].sort((a,b) => a-b).map(ep => ({ id: `${id}:1:${ep}`, title: `Episodio ${ep}`, season: 1, episode: ep })) } })
        }
        const m = id.match(/^(jp:[^:]+):1:(\d+(?:\.\d+)?)$/), s = m && series.get(m[1])
        const keys = s?.videos.get(Number(m[2])) || []
        return json(200, { streams: keys.map(key => { const {ep} = files.get(key); return { name: `Japan-Paw ${ep.resolution || ''}p`, title: ep.quality || fileName(ep), url: `${base}/play/${key}`, behaviorHints: { notWebReady: true, bingeGroup: `jp-${ep.group || ''}-${ep.resolution || ''}`, filename: fileName(ep) } } }) })
      }
      const key = url.pathname.match(/^\/play\/([a-f0-9]{24})$/)?.[1], entry = files.get(key)
      if (!entry) return json(404, { error: 'No encontrado' })
      if (req.headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) return json(400, { error: 'Solo se admite un rango de bytes' })
      controller = new AbortController(); active.add(controller)
      res.once('close', () => controller.abort())
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new Error('Tiempo de espera agotado')), 60000); timer.unref() }; arm()
      const upstream = async () => {
        let destination = entry.url
        for (let i = 0; i < 5; i++) {
          if (!allowed(destination)) throw new Error('Destino de vídeo no permitido')
          const headers = { 'User-Agent': UA, 'Accept-Encoding': 'identity', Referer: new URL(destination).origin + '/' }
          if (req.headers.range) headers.Range = req.headers.range
          if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range']
          const r = await request(destination, { method: req.method, headers, signal: controller.signal, redirect: 'manual' })
          if ([301,302,303,307,308].includes(r.status)) { const location = r.headers.get('location'); await r.body?.cancel(); if (!location) throw new Error('Redirección sin destino'); destination = new URL(location, destination).href; continue }
          return r
        }
        throw new Error('Demasiadas redirecciones')
      }
      let response = await upstream()
      if ([404,410].includes(response.status)) { await response.body?.cancel(); await refresh(entry, controller.signal); response = await upstream() }
      const type = response.headers.get('content-type') || ''
      if (req.headers.range && !req.headers['if-range'] && response.status === 200) {
        await response.body?.cancel()
        return json(502, { error: 'El proveedor ignoró el rango solicitado; no se descargará el archivo completo para hacer un salto.' })
      }
      if (!response.ok && response.status !== 416 || /text\/html|application\/json/i.test(type)) {
        const status = response.ok ? 502 : response.status
        await response.body?.cancel(); log(`[HTTP] ${entry.row.title} · ${entry.ep.episode}: ${status}`)
        return json(status, { error: `Proveedor de vídeo: HTTP ${status}` })
      }
      for (const h of ['content-length','content-range','accept-ranges','etag','last-modified','retry-after']) { const v = response.headers.get(h); if (v) res.setHeader(h, v) }
      res.setHeader('Content-Type', type || (/\.mp4$/i.test(fileName(entry.ep)) ? 'video/mp4' : 'video/x-matroska'))
      res.writeHead(response.status)
      log(`[HTTP] ${entry.row.title} · ${entry.ep.episode} · ${req.headers.range || req.method}: ${response.status}`)
      if (req.method === 'HEAD' || response.status === 416) { await response.body?.cancel(); return res.end() }
      const idle = new Transform({ transform(chunk, encoding, callback) { arm(); callback(null, chunk) } })
      await pipeline(Readable.fromWeb(response.body), idle, res, { signal: controller.signal })
    } catch (err) {
      if (!res.destroyed) { log(`[HTTP] ${err.message}`); if (!res.headersSent) json(502, { error: 'No se pudo transmitir el vídeo. Revisa el servicio local y WARP.' }); else res.destroy() }
    } finally { clearTimeout(timer); if (controller) { controller.abort(); active.delete(controller) } }
  })
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) }) }
  catch (err) { await pool?.close(); throw err }
  base = `http://127.0.0.1:${server.address().port}`
  return { server, base, series, close: async () => { for (const c of active) c.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await pool?.close() } }
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2), opts = {}
  let catalogPath = 'raw-catalog.json'
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--direct') opts.useProxy = false
    else if (['--port', '--catalog', '--proxy-file'].includes(args[i]) && args[i+1]) { const arg = args[i], value = args[++i]; if (arg === '--catalog') catalogPath = value; else if (arg === '--port') opts.port = Number(value); else opts.proxyFile = value }
    else throw new Error(`Opción inválida: ${args[i]}`)
  }
  const app = await createAddon({ ...opts, catalog: JSON.parse(readFileSync(catalogPath, 'utf8')) })
  console.log(`Japan-Paw Directo: ${app.base}\nManifiesto: ${app.base}/manifest.json\n${app.series.size} series; sin torrents ni preindexación.`)
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close())
}
