import parseTorrent from 'parse-torrent'
import { catalogLoader } from './lib/catalog.js'
import { fileName, sameRelease, matchSeries, episodeNumber, resolution, normalize, isBatchTorrent, onlineState, VIDEO } from './lib/matching.js'

const INDEX_URL = 'http://127.0.0.1:8787/indexed-catalog.json'
const validHash = value => /^[a-f\d]{40}$/i.test(value || '')
const count = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0

export function createTorrentSource(indexUrl = INDEX_URL) {
  const load = catalogLoader(indexUrl)
  const cache = new Map()
  async function memo(key, action) {
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.value
    const value = await action()
    if (value !== null) {
      cache.delete(key)
      if (cache.size >= 200) cache.delete(cache.keys().next().value)
      cache.set(key, { value, expires: Date.now() + 300_000 })
    }
    return value
  }
  async function metadata(url, expectedHash, ep, fetchFn) {
    if (!/^https?:\/\//.test(url) || !validHash(expectedHash)) return null
    try {
      const parsed = await memo('torrent:' + url, async () => {
        const response = await fetchFn(url)
        if (!response.ok) return null
        if (Number(response.headers?.get('content-length')) > 4 * 1024 * 1024) { await response.body?.cancel(); return null }
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 4 * 1024 * 1024) return null
        return parseTorrent(bytes)
      })
      if (!parsed || parsed.infoHash !== expectedHash.toLowerCase()) return null
      if (!Number.isSafeInteger(parsed.length) || parsed.length <= 0 || !Number.isSafeInteger(parsed.pieceLength) || parsed.pieceLength <= 0 || parsed.pieces.length !== Math.ceil(parsed.length / parsed.pieceLength)) return null
      // Single-file metadata guarantees the HTTP URL covers every torrent byte.
      if (parsed.files.length !== 1 || !VIDEO.test(parsed.files[0].name) || isBatchTorrent(parsed)) return null
      if (!sameRelease(ep, parsed.files[0].name)) return null
      if (ep.size && Number(ep.size) !== parsed.length) return null
      return parsed
    } catch { return null }
  }
  async function search(series, ep, titles, fetchFn, signal, movie) {
    const number = Number(ep.episode)
    const queries = new Set()
    const crc = ep.crc32 || fileName(ep).match(/\[([a-f\d]{8})\]/i)?.[1]
    if (crc) queries.add(crc)
    queries.add(fileName(ep).replace(/\.[a-z0-9]+$/i, ''))
    for (const title of [...titles, series.title].filter(Boolean).slice(0, 3)) {
      queries.add(movie ? title : `${title} ${String(number).padStart(2, '0')}`)
    }
    for (const q of queries) {
      if (!q || signal.aborted) break
      let items
      try {
        items = await memo('query:' + q, async () => {
          const response = await fetchFn(`https://feed.animetosho.org/json?q=${encodeURIComponent(q)}`)
          if (!response.ok) return null
          const data = await response.json()
          return Array.isArray(data) ? data : null
        })
      } catch { continue }
      const candidates = (items || []).filter(item => {
        if (!validHash(item.info_hash) || !item.torrent_url || isBatchTorrent(item)) return false
        const title = item.title || item.torrent_name || ''
        if (sameRelease(ep, title) || sameRelease(ep, title + '.mkv') || sameRelease(ep, title + '.mp4')) return true
        const r = resolution(title), expectedRes = resolution(fileName(ep)) || String(ep.resolution || '')
        if (r && expectedRes && r !== expectedRes) return false
        if (!movie && episodeNumber(title) !== number) return false
        // Weak search matches are only candidates: the actual torrent file must match below.
        return [...titles, series.title, ...(series.aliases || [])].some(t => normalize(t).length >= 6 && normalize(title).includes(normalize(t)))
      }).sort((a, b) => Number(Boolean(crc && String(b.title).includes(crc))) - Number(Boolean(crc && String(a.title).includes(crc))))
      for (const item of candidates.slice(0, 4)) {
        if (signal.aborted) return null
        const parsed = await metadata(item.torrent_url, item.info_hash, ep, fetchFn)
        if (parsed) return { parsed, url: item.torrent_url, item }
      }
    }
    return null
  }
  async function single(query, movie = false) {
    const signal = AbortSignal.timeout(18_000)
    const fetchFn = (url, options = {}) => (query.fetch ?? fetch)(url, { ...options, signal: AbortSignal.any([signal, options.signal ?? AbortSignal.timeout(5000)]) })
    const number = Number(movie ? 1 : query.episode)
    if (!Number.isFinite(number) || number < 0) return []
    const requested = String(query.resolution || '').replace(/p$/i, '')
    const exclusions = (query.exclusions || []).map(x => String(x).toLowerCase()).filter(Boolean)

    // 1. Vía Rápida: Catálogo Pre-Verificado por AniList ID (dist/data/<id>.json)
    if (query.anilistId) {
      try {
        const dataUrl = new URL(`data/${query.anilistId}.json`, indexUrl).href
        const dataRes = await fetchFn(dataUrl)
        if (dataRes.ok) {
          const animeData = await dataRes.json()
          const matched = (animeData.episodes || []).filter(ep => {
            if (Number(ep.episode) !== number) return false
            if (requested && String(ep.resolution) !== requested) return false
            const title = ep.fileName || ep.title || ''
            if (exclusions.some(x => title.toLowerCase().includes(x))) return false
            return true
          })
          if (matched.length > 0) {
            return matched.map(ep => {
              const original = ep.fileName || `${animeData.title} - ${String(ep.episode).padStart(2, '0')} [${ep.resolution}p].mkv`
              const ext = original.match(/\.[^.]+$/)?.[0] || ''
              const baseName = ext ? original.slice(0, -ext.length) : original
              return {
                title: `${baseName} [DDL verificado]${ext}`,
                link: new URL(ep.torrent || ep.torrentPath, indexUrl).href,
                hash: (ep.hash || ep.infoHash).toLowerCase(),
                size: ep.size,
                date: new Date(ep.verified?.verifiedAt || 0),
                seeders: 0,
                leechers: 0,
                downloads: 0,
                accuracy: 'high'
              }
            })
          }
        }
      } catch {}
    }

    // 2. Vía Dinámica / Fallback para series no pre-indexadas
    const catalog = await load(fetchFn)
    const series = matchSeries(catalog, query.titles, query.anilistId)
    const results = [], seen = new Set()
    for (const s of series) {
      for (const ep of s.episodes || []) {
        if (signal.aborted) return results
        if (Number(ep.episode) !== number || (requested && (resolution(fileName(ep)) || String(ep.resolution)) !== requested)) continue
        if (exclusions.some(x => `${fileName(ep)} ${ep.quality}`.toLowerCase().includes(x))) continue
        let match
        if (ep.torrentPath && validHash(ep.infoHash)) {
          const url = new URL(ep.torrentPath, indexUrl).href
          const parsed = await metadata(url, ep.infoHash, ep, fetchFn)
          if (parsed) match = { parsed, url, item: {} }
        }
        if (!match) match = await search(s, ep, query.titles || [], fetchFn, signal, movie)
        if (!match || seen.has(match.parsed.infoHash)) continue
        const { parsed, url, item } = match
        if (exclusions.some(x => parsed.files[0].name.toLowerCase().includes(x))) continue
        seen.add(parsed.infoHash)
        const state = onlineState(ep)
        const tag = state === true ? '[DDL verificado]' : state === false ? '[DDL caído - Solo P2P]' : '[DDL sin verificar]'
        const original = parsed.files[0].name
        const extension = original.match(/\.[^.]+$/)?.[0] || ''
        results.push({
          title: original.slice(0, original.length - extension.length) + ' ' + tag + extension,
          link: url, hash: parsed.infoHash, size: parsed.length,
          date: new Date(item.timestamp ? item.timestamp * 1000 : ep.hashedAt || 0),
          seeders: count(item.seeders), leechers: count(item.leechers), downloads: count(item.downloads),
          accuracy: s.anilistId ? 'medium' : 'low'
        })
      }
    }
    return results
  }
  return {
    async test() { await load(fetch, true); return true },
    single: query => single(query),
    movie: query => single(query, true),
    async batch() { return [] }
  }
}
export default createTorrentSource()
