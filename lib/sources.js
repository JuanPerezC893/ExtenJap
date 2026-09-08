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

export async function searchNyaa(query, fetchFn = fetch) {
  if (!query || !query.trim()) return []
  const url = `https://nyaa.si/?f=0&c=0_0&q=${encodeURIComponent(query.trim())}`
  try {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000)
    })
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
    return []
  }
}

export async function searchAnimeTosho(query, fetchFn = fetch) {
  if (!query || !query.trim()) return []
  const url = `https://feed.animetosho.org/json?q=${encodeURIComponent(query.trim())}`
  try {
    const res = await fetchFn(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(10000)
    })
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
    return []
  }
}

export function buildSearchQueries(series, ep) {
  const epNum = Number(ep.episode)
  const fn = ep.fileName || ''
  const cleanFn = cleanReleaseFileName(fn)
  const crc = ep.crc32 || extractCrc32(fn)
  const group = extractFansubGroup(fn) || (ep.quality ? extractFansubGroup(ep.quality) : null)
  
  const cleanTitle = (series.title || '').replace(/[!?:;,."']/g, ' ').replace(/\s+/g, ' ').trim()
  const epStr = String(epNum).padStart(2, '0')
  const resStr = ep.resolution ? `${ep.resolution}p` : ''

  const isMovie = (series.episodes?.length === 1 && epNum === 1) || /\b(movie|gekijouban|pelicula)\b/i.test(series.title || '')

  const queries = []

  // 1. Si hay CRC32, máxima prioridad
  if (crc) {
    queries.push({ query: crc, priority: 'crc', provider: 'nyaa' })
    queries.push({ query: crc, priority: 'crc', provider: 'animetosho' })
  }

  // 2. Nombre de archivo limpio (sin marcas de Japan-Paw)
  if (cleanFn && cleanFn !== cleanTitle) {
    queries.push({ query: cleanFn, priority: 'filename', provider: 'all' })
  }

  // 3. Grupo Fansub + Título + Episodio
  if (group) {
    queries.push({ query: `[${group}] ${cleanTitle} ${epStr}`, priority: 'group', provider: 'all' })
    if (resStr) queries.push({ query: `[${group}] ${cleanTitle} ${epStr} ${resStr}`, priority: 'group_res', provider: 'all' })
  }

  // 4. Título + Episodio (+ Resolución)
  if (!isMovie) {
    if (resStr) queries.push({ query: `${cleanTitle} ${epStr} ${resStr}`, priority: 'title_ep_res', provider: 'all' })
    queries.push({ query: `${cleanTitle} ${epStr}`, priority: 'title_ep', provider: 'all' })
  } else {
    if (resStr) queries.push({ query: `${cleanTitle} ${resStr}`, priority: 'movie_res', provider: 'all' })
    queries.push({ query: cleanTitle, priority: 'movie', provider: 'all' })
  }

  // 5. Alias de AniList (títulos en inglés, romaji alternativo)
  for (const alias of (series.aliases || [])) {
    const cleanAlias = String(alias).replace(/[!?:;,."']/g, ' ').replace(/\s+/g, ' ').trim()
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
