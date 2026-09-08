import { episodeNumber, resolution, isBatchTorrent } from './matching.js'

export function extractCrc32(str) {
  if (!str) return null
  const m = String(str).match(/\[([a-f0-9]{8})\]/i)
  return m ? m[1].toUpperCase() : null
}

export function extractFansubGroup(str) {
  if (!str) return null
  const m = String(str).match(/^\[([^\]]+)\]/)
  if (!m) return null
  const group = m[1].trim()
  if (/^(Japan-Paw|Web|BD|1080p|720p|480p)/i.test(group)) return null
  return group
}

export function cleanReleaseFileName(str) {
  if (!str) return ''
  return String(str)
    .replace(/\(Japan-Paw(\.net)?\)/gi, '')
    .replace(/\[Japan-Paw(\.net)?\]/gi, '')
    .replace(/\.(mkv|mp4|avi)$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

let lastNyaaCall = 0
const NYAA_MIN_DELAY_MS = 600

let lastToshoCall = 0
const TOSHO_MIN_DELAY_MS = 400

async function throttleNyaa() {
  const now = Date.now()
  const wait = Math.max(0, NYAA_MIN_DELAY_MS - (now - lastNyaaCall))
  lastNyaaCall = now + wait
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

async function throttleTosho() {
  const now = Date.now()
  const wait = Math.max(0, TOSHO_MIN_DELAY_MS - (now - lastToshoCall))
  lastToshoCall = now + wait
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
}

export async function searchNyaa(query, fetchFn = fetch, retries = 2) {
  if (!query || !query.trim()) return []
  const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query.trim())}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttleNyaa()
    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (res.status === 429 || res.status === 503) {
        const backoffMs = (attempt + 1) * 2500
        console.warn(`[Nyaa] Rate-limit (HTTP ${res.status}) detectado. Pausando ${backoffMs / 1000}s antes de reintentar...`)
        await new Promise(r => setTimeout(r, backoffMs))
        continue
      }

      if (!res.ok) return []
      const html = await res.text()
      const rows = html.split('</tr>')
      const results = []

      for (const r of rows) {
        const mLink = r.match(/href="(\/download\/\d+\.torrent)"/)
        const mTitle = r.match(/<a href="\/view\/\d+"[^>]*title="([^"]+)"/) || r.match(/<a href="\/view\/\d+"[^>]*>([^<]+)<\/a>/)
        if (mLink && mTitle) {
          const title = mTitle[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()
          const torrent_url = `https://nyaa.si${mLink[1]}`
          results.push({
            title,
            torrent_url,
            source: 'nyaa'
          })
        }
      }
      return results
    } catch {
      if (attempt === retries) return []
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  return []
}

export async function searchAnimeTosho(query, fetchFn = fetch, retries = 2) {
  if (!query || !query.trim()) return []
  const url = `https://feed.animetosho.org/json?q=${encodeURIComponent(query.trim())}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttleTosho()
    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        },
        signal: AbortSignal.timeout(10000)
      })

      if (res.status === 429 || res.status === 503) {
        const backoffMs = (attempt + 1) * 2000
        console.warn(`[AnimeTosho] Rate-limit (HTTP ${res.status}) detectado. Pausando ${backoffMs / 1000}s...`)
        await new Promise(r => setTimeout(r, backoffMs))
        continue
      }

      if (!res.ok) return []
      const data = await res.json()
      if (!Array.isArray(data)) return []
      return data.map(item => ({
        title: item.title || item.torrent_name || '',
        torrent_url: item.torrent_url,
        info_hash: item.info_hash,
        num_files: item.num_files,
        total_size: item.total_size,
        source: 'animetosho'
      }))
    } catch {
      if (attempt === retries) return []
      await new Promise(r => setTimeout(r, 1000))
    }
  }
  return []
}


export function buildSearchQueries(series, ep) {
  const epNum = Number(ep.episode)
  const fn = ep.fileName || ''
  const cleanFn = cleanReleaseFileName(fn)
  const cleanFnNoCrc = cleanFn.replace(/\[[a-f0-9]{8}\]/gi, '').replace(/\s+/g, ' ').trim()
  const crc = ep.crc32 || extractCrc32(fn)
  const group = extractFansubGroup(fn) || (ep.quality ? extractFansubGroup(ep.quality) : null)
  
  // Limpiar puntuación agresiva (guiones y dos puntos) que Nyaa interpreta como operador de exclusión (-)
  const cleanTitle = (series.title || '').replace(/[:\-!?,._~"'()]/g, ' ').replace(/\s+/g, ' ').trim()
  const epStr = String(epNum).padStart(2, '0')
  const resStr = ep.resolution ? `${ep.resolution}p` : ''

  const isMovie = (series.episodes?.length === 1 && epNum === 1) || /\b(movie|gekijouban|pelicula)\b/i.test(series.title || '')

  const queries = []

  // 1. Si hay CRC32, máxima prioridad
  if (crc) {
    queries.push({ query: crc, priority: 'crc', provider: 'nyaa' })
    queries.push({ query: crc, priority: 'crc', provider: 'animetosho' })
  }

  // 2. Nombre de archivo limpio sin CRC (evita que un CRC scraped erróneo contamine la búsqueda)
  if (cleanFnNoCrc && cleanFnNoCrc !== cleanTitle) {
    queries.push({ query: cleanFnNoCrc, priority: 'filename_nocrc', provider: 'all' })
  }

  // 3. Normalizar puntos y guiones a espacios en nombres tipo Scene/WEB-DL
  const cleanFnDots = cleanFnNoCrc.replace(/[._\-]/g, ' ').replace(/\s+/g, ' ').trim()
  if (cleanFnDots && cleanFnDots !== cleanFnNoCrc && cleanFnDots.length > 5) {
    queries.push({ query: cleanFnDots, priority: 'filename_dots', provider: 'all' })
  }

  // 4. Nombre de archivo limpio con CRC original
  if (cleanFn && cleanFn !== cleanTitle && cleanFn !== cleanFnNoCrc) {
    queries.push({ query: cleanFn, priority: 'filename', provider: 'all' })
  }

  // Extraer formato S01E01 / S03E01 si el archivo o título lo contiene
  const mSeasonEp = fn.match(/S(\d{1,2})E(\d{1,3})/i)
  const sEpStr = mSeasonEp ? mSeasonEp[0].toUpperCase() : null

  // 5. Grupo Fansub + Título + Episodio
  if (group) {
    queries.push({ query: `[${group}] ${cleanTitle} ${epStr}`, priority: 'group', provider: 'all' })
    if (sEpStr) queries.push({ query: `[${group}] ${cleanTitle} ${sEpStr}`, priority: 'group_s_ep', provider: 'all' })
    if (resStr) queries.push({ query: `[${group}] ${cleanTitle} ${epStr} ${resStr}`, priority: 'group_res', provider: 'all' })
  }

  if (sEpStr) {
    queries.push({ query: `${cleanTitle} ${sEpStr}`, priority: 'title_s_ep', provider: 'all' })
  }

  // 5. Título + Episodio (+ Resolución)
  if (!isMovie) {
    if (resStr) queries.push({ query: `${cleanTitle} ${epStr} ${resStr}`, priority: 'title_ep_res', provider: 'all' })
    queries.push({ query: `${cleanTitle} ${epStr}`, priority: 'title_ep', provider: 'all' })
  } else {
    if (resStr) queries.push({ query: `${cleanTitle} ${resStr}`, priority: 'movie_res', provider: 'all' })
    queries.push({ query: cleanTitle, priority: 'movie', provider: 'all' })
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
