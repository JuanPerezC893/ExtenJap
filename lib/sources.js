import { IndexerNetworkError, retryAfterTime } from './indexer-network.js'

export function extractCrc32(str) {
  if (!str) return null
  const m = String(str).match(/\[([a-f0-9]{8})(?:\]|\s|\[|$)/i)
  return m ? m[1].toUpperCase() : null
}

export function extractFansubGroup(str) {
  if (!str) return null
  const cleaned = cleanReleaseFileName(str)
  const m = cleaned.match(/^\[([^\]]+)\]/)
  if (!m) return null
  const group = m[1].trim()
  if (/^(Japan[- ]?Pa?s?w|Web|BD|1080p|720p|480p)/i.test(group)) return null
  return group
}

export function cleanReleaseFileName(str) {
  if (!str) return ''
  return String(str)
    .replace(/\[\s*Japan[- ]?Pa?s?w!?(\.net)?(?:\s*-\s*([^\]]+))?\s*\]/gi, (m, g1, realGroup) => realGroup ? '[' + realGroup.trim() + ']' : '')
    .replace(/\(\s*Japan[- ]?Pa?s?w!?(\.net)?(?:\s*-\s*([^)]+))?\s*\)/gi, (m, g1, realGroup) => realGroup ? '(' + realGroup.trim() + ')' : '')
    .replace(/\.(mkv|mp4|avi)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function invalidResponse(provider, url, message) {
  return new IndexerNetworkError(message, { code: 'INVALID_RESPONSE', provider, url })
}

function decodeHtml(text) {
  return String(text).replace(/&(?:amp|quot|apos|lt|gt|#39|#\d+|#x[a-f\d]+);/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]
    const number = entity.slice(2, -1)
    const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number)
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))
  return match ? decodeHtml(match[2]) : ''
}

// A successful empty result still has the site's result table. A challenge page,
// maintenance banner or changed schema must not be cached as "no matches".
export function parseNyaaResults(html, url = 'https://nyaa.si/') {
  const tables = [...String(html).matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table\s*>/gi)]
  const table = tables.find(match => /(?:^|\s)torrent-list(?:\s|$)/i.test(attribute(match[1], 'class')))
  if (!table) throw invalidResponse('nyaa', url, 'Nyaa no devolvió su tabla de resultados')
  const results = []
  for (const row of table[2].split(/<\/tr\s*>/i)) {
    const anchors = [...row.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)].map(match => ({
      href: attribute(match[1], 'href'),
      title: attribute(match[1], 'title') || decodeHtml(match[2].replace(/<[^>]+>/g, '')).trim()
    }))
    const download = anchors.find(anchor => /^\/download\/\d+\.torrent(?:\?.*)?$/.test(anchor.href))
    const id = download?.href.match(/\/download\/(\d+)\.torrent/)[1]
    const title = id && anchors.find(anchor => anchor.href === `/view/${id}` && anchor.title)?.title
    if (download && title) results.push({ title, torrent_url: new URL(download.href, 'https://nyaa.si').href, source: 'nyaa' })
    else if (anchors.some(anchor => /^\/(?:download|view)\/\d+/.test(anchor.href))) {
      throw invalidResponse('nyaa', url, 'Fila de resultados de Nyaa no reconocida')
    }
  }
  return results
}

export function parseAnimeToshoResults(data, url = 'https://feed.animetosho.xyz/json') {
  if (!Array.isArray(data)) throw invalidResponse('animetosho', url, 'AnimeTosho no devolvió una lista de resultados')
  return data.map(item => {
    if (!item || typeof item !== 'object' || typeof (item.title || item.torrent_name) !== 'string') {
      throw invalidResponse('animetosho', url, 'Resultado de AnimeTosho no reconocido')
    }
    return {
      title: item.title || item.torrent_name,
      torrent_url: item.torrent_url,
      info_hash: item.info_hash,
      num_files: item.num_files,
      total_size: item.total_size,
      source: 'animetosho'
    }
  })
}

export function parseAniSearchResults(data, url = 'https://api.anisearch.org/torrents') {
  if (!Array.isArray(data)) throw invalidResponse('anisearch', url, 'AniSearch no devolvió una lista de resultados')
  return data.map(item => {
    if (!item || typeof item !== 'object' || typeof (item.torrentName || item.releaseName) !== 'string') {
      throw invalidResponse('anisearch', url, 'Resultado de AniSearch no reconocido')
    }
    let torrentUrl = item.torrentFileUrl || null
    if (torrentUrl && /\/view\/(\d+)\/torrent$/i.test(torrentUrl)) {
      torrentUrl = torrentUrl.replace(/\/view\/(\d+)\/torrent$/i, '/download/$1.torrent')
    }
    return {
      title: item.torrentName || item.releaseName,
      torrent_url: torrentUrl,
      info_hash: item.infohash,
      total_size: item.length,
      source: 'anisearch'
    }
  })
}

export function parseNekoBTResults(data, url = 'https://nekobt.to/api/v1/torrents/search') {
  const results = data?.data?.results || data?.results || (Array.isArray(data) ? data : null)
  if (!Array.isArray(results)) throw invalidResponse('nekobt', url, 'NekoBT no devolvió una lista de resultados')
  return results.map(item => {
    if (!item || typeof item !== 'object' || typeof item.title !== 'string') {
      throw invalidResponse('nekobt', url, 'Resultado de NekoBT no reconocido')
    }
    const torrentUrl = item.id ? `https://nekobt.to/api/v1/torrents/${item.id}/download?public=true` : (item.torrent_url || null)
    return {
      title: item.title,
      torrent_url: torrentUrl,
      info_hash: item.infohash,
      total_size: Number(item.filesize) || undefined,
      source: 'nekobt'
    }
  })
}

async function searchResponse(url, provider, fetchFn, options, read) {
  // The old numeric retries argument remains accepted; retries now belong to the
  // resumable work queue, never to each worker/provider independently.
  const settings = typeof options === 'object' && options !== null ? options : {}
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(new DOMException('Búsqueda agotada', 'TimeoutError')), settings.timeoutMs ?? 10000)
  const signal = AbortSignal.any([timeout.signal, settings.signal].filter(Boolean))
  try {
    signal.throwIfAborted()
    const response = await fetchFn(url, {
      headers: { 'User-Agent': 'JapanPawIndexer/1.0' }, signal, provider,
      maxBodyBytes: settings.maxBodyBytes ?? 8 * 1024 * 1024
    })
    if (!response.ok) {
      try { response.body?.cancel()?.catch(() => {}) } catch { /* Already consumed. */ }
      const rateLimit = response.status === 429 || response.status === 503
      throw new IndexerNetworkError(`HTTP ${response.status} consultando ${provider}`, {
        code: response.status === 429 ? 'RATE_LIMITED' : response.status === 503 ? 'SERVICE_UNAVAILABLE' : 'HTTP_ERROR',
        provider, url, status: response.status,
        retryAt: rateLimit ? retryAfterTime(response.headers.get('retry-after')) : null
      })
    }
    const results = await read(response)
    signal.throwIfAborted()
    return results
  } catch (error) {
    if (error instanceof IndexerNetworkError) throw error
    const code = signal.aborted ? (signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'ABORTED') :
      error instanceof SyntaxError ? 'INVALID_RESPONSE' : 'NETWORK_ERROR'
    throw new IndexerNetworkError(error.message || 'Error de búsqueda', { code, provider, url, cause: error })
  } finally {
    clearTimeout(timer)
  }
}

export async function searchNyaa(query, fetchFn = fetch, options = {}) {
  if (!query || !query.trim()) return []
  const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query.trim())}`
  return searchResponse(url, 'nyaa', fetchFn, options, async response => parseNyaaResults(await response.text(), url))
}

export async function searchAnimeTosho(query, fetchFn = fetch, options = {}) {
  if (!query || !query.trim()) return []
  const url = `https://feed.animetosho.xyz/json?q=${encodeURIComponent(query.trim())}`
  return searchResponse(url, 'animetosho', fetchFn, options, async response => parseAnimeToshoResults(await response.json(), url))
}

export async function searchAniSearch(query, fetchFn = fetch, options = {}) {
  if (!query || !query.trim()) return []
  const cleanQuery = query.trim().replace(/\s+/g, '*')
  const url = `https://api.anisearch.org/torrents?name=ilike.*${encodeURIComponent(cleanQuery)}*&limit=25`
  return searchResponse(url, 'anisearch', fetchFn, options, async response => parseAniSearchResults(await response.json(), url))
}

export async function searchNekoBT(query, fetchFn = fetch, options = {}) {
  if (!query || !query.trim()) return []
  const url = `https://nekobt.to/api/v1/torrents/search?query=${encodeURIComponent(query.trim())}&limit=25`
  return searchResponse(url, 'nekobt', fetchFn, options, async response => parseNekoBTResults(await response.json(), url))
}

export function buildSearchQueries(series, ep) {
  const epNum = Number(ep.episode)
  const fn = ep.fileName || ''
  const cleanFn = cleanReleaseFileName(fn)
  const crc = ep.crc32 || extractCrc32(fn)
  const group = extractFansubGroup(fn) || (ep.quality ? extractFansubGroup(ep.quality) : null)
  
  // Limpiar puntuación agresiva (guiones y dos puntos) que Nyaa/motores interpretan erróneamente
  const cleanTitle = (series.title || '').replace(/[:\-!?,._~"'()]/g, ' ').replace(/\s+/g, ' ').trim()
  const epStr = String(epNum).padStart(2, '0')
  const resStr = ep.resolution ? `${ep.resolution}p` : ''

  const isMovie = (series.episodes?.length === 1 && epNum === 1) || /\b(movie|gekijouban|pelicula)\b/i.test(series.title || '')

  const queries = []

  // 1. Si hay CRC32, máxima prioridad en todos los proveedores
  if (crc) {
    queries.push({ query: crc, priority: 'crc', provider: 'all' })
  }

  // Extraer formato S01E01 / S03E01 si el archivo o título lo contiene
  const mSeasonEp = fn.match(/S(\d{1,2})E(\d{1,3})/i)
  const sEpStr = mSeasonEp ? mSeasonEp[0].toUpperCase() : null

  // 2. Grupo Fansub + Título + Episodio
  if (group) {
    queries.push({ query: `[${group}] ${cleanTitle} ${epStr}`, priority: 'group', provider: 'all' })
    if (resStr) queries.push({ query: `[${group}] ${cleanTitle} ${epStr} ${resStr}`, priority: 'group_res', provider: 'all' })
    if (sEpStr) queries.push({ query: `[${group}] ${cleanTitle} ${sEpStr}`, priority: 'group_s_ep', provider: 'all' })
  }

  // 3. Título + Episodio (+ Resolución)
  if (!isMovie) {
    if (resStr) queries.push({ query: `${cleanTitle} ${epStr} ${resStr}`, priority: 'title_ep_res', provider: 'all' })
    queries.push({ query: `${cleanTitle} ${epStr}`, priority: 'title_ep', provider: 'all' })
    if (sEpStr) queries.push({ query: `${cleanTitle} ${sEpStr}`, priority: 'title_s_ep', provider: 'all' })
  } else {
    if (resStr) queries.push({ query: `${cleanTitle} ${resStr}`, priority: 'movie_res', provider: 'all' })
    queries.push({ query: cleanTitle, priority: 'movie', provider: 'all' })
  }

  // 4. Nombre de archivo limpio sin CRC ni sufijos de re-encode [Web 1080p], etc.
  const cleanFnNoCrc = cleanFn
    .replace(/\[[a-f0-9]{8}\]/gi, '')
    .replace(/\[(Web|BD|HDTV|DVD)(\s+\d+p)?\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleanFnNoCrc && cleanFnNoCrc !== cleanTitle && cleanFnNoCrc !== `${cleanTitle} ${epStr}`) {
    queries.push({ query: cleanFnNoCrc, priority: 'filename_nocrc', provider: 'all' })
  }

  // 5. Normalizar puntos y guiones a espacios en nombres tipo Scene/WEB-DL
  const cleanFnDots = cleanFnNoCrc.replace(/[._\-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleanFnDots && cleanFnDots !== cleanFnNoCrc && cleanFnDots.length > 5 && cleanFnDots !== `${cleanTitle} ${epStr}`) {
    queries.push({ query: cleanFnDots, priority: 'filename_dots', provider: 'all' })
  }

  // 6. Alias de AniList (títulos en inglés, romaji alternativo)
  for (const alias of (series.aliases || [])) {
    const cleanAlias = String(alias).replace(/[:\-!?,._~"'()]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!cleanAlias || cleanAlias.toLowerCase() === cleanTitle.toLowerCase()) continue

    if (group) {
      queries.push({ query: `[${group}] ${cleanAlias} ${epStr}`, priority: 'alias_group', provider: 'all' })
    }
    if (!isMovie) {
      if (resStr) queries.push({ query: `${cleanAlias} ${epStr} ${resStr}`, priority: 'alias_ep_res', provider: 'all' })
      queries.push({ query: `${cleanAlias} ${epStr}`, priority: 'alias_ep', provider: 'all' })
    } else {
      queries.push({ query: cleanAlias, priority: 'alias_movie', provider: 'all' })
    }
  }

  // Desduplicar manteniendo el orden de prioridad
  const seen = new Set()
  const unique = []
  for (const q of queries) {
    const key = `${q.provider}:${q.query}`
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(q)
    }
  }

  return unique
}
