// ESM para el worker de Hayase (TorrentSource).
const INDEX_URL = 'http://127.0.0.1:8787/indexed-catalog.json'
let cache
let cachedAt = 0

const normalize = value => String(value ?? '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/\p{M}/gu, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()

async function loadIndex(fetchFn, refresh = false) {
  if (!refresh && cache && Date.now() - cachedAt < 300_000) return cache
  const response = await fetchFn(INDEX_URL)
  if (!response.ok) throw new Error(`No se pudo cargar el catálogo: HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data)) throw new Error('Catálogo inválido')
  cache = data
  cachedAt = Date.now()
  return data
}

async function fetchAnimeToshoTorrent(seriesTitle, ep, fetchFn) {
  try {
    const cleanTitle = seriesTitle.replace(/[!?:;,.'"()[\]]/g, ' ').replace(/\s+/g, ' ').trim()
    const epNum = Math.floor(Number(ep.episode))
    const epStr = String(epNum).padStart(2, '0')
    const q = encodeURIComponent(`${cleanTitle} ${epStr}`)
    const res = await fetchFn(`https://feed.animetosho.org/json?q=${q}`, {
      headers: { 'User-Agent': 'Hayase-JapanPaw/1.0' },
      signal: AbortSignal.timeout(3500)
    })
    if (!res.ok) return null
    const items = await res.json()
    if (!Array.isArray(items) || !items.length) return null

    // 1. Prioridad máxima: match exacto por CRC32
    if (ep.crc32) {
      const match = items.find(i => i.title && i.title.toUpperCase().includes(ep.crc32.toUpperCase()))
      if (match?.info_hash && match?.torrent_url) return match
    }

    // 2. Prioridad: match por fansub group
    if (ep.group) {
      const match = items.find(i => i.title && i.title.toLowerCase().includes(ep.group.toLowerCase()))
      if (match?.info_hash && match?.torrent_url) return match
    }

    // 3. Match por resolución
    const resStr = `${ep.resolution}p`
    const matchRes = items.find(i => i.title && i.title.includes(resStr))
    if (matchRes?.info_hash && matchRes?.torrent_url) return matchRes

    // 4. Primer resultado que tenga torrent_url e info_hash
    return items.find(i => i.info_hash && i.torrent_url) || null
  } catch {
    return null
  }
}

export default new class JapanPawTorrentSource {
  async test() {
    const data = await loadIndex(fetch, true)
    return Array.isArray(data)
  }

  async single(query) {
    const fetchFn = query.fetch ?? fetch
    const catalog = await loadIndex(fetchFn)
    const titles = (query.titles ?? []).map(normalize).filter(Boolean)
    const byId = query.anilistId ? catalog.filter(s => Number(s.anilistId) === Number(query.anilistId)) : []

    const series = byId.length ? byId : catalog.filter(s => {
      const sTitle = normalize(s.title)
      if (titles.some(t => t === sTitle || t.includes(sTitle) || sTitle.includes(t))) return true
      if (s.aliases && Array.isArray(s.aliases)) {
        if (s.aliases.some(a => titles.includes(normalize(a)))) return true
      }
      return false
    })

    const targetEpisode = Number(query.episode)
    const exclusions = (query.exclusions ?? []).map(x => String(x).toLowerCase()).filter(Boolean)
    const results = []

    for (const s of series) {
      const eps = (s.episodes ?? []).filter(e => Number(e.episode) === targetEpisode)

      for (const e of eps) {
        const ddlTag = e.isOnline === false ? '[⚠️ DDL Caído - Solo P2P]' : '[⚡ DDL Japan-Paw]'
        const baseTitle = (e.fileName || `${s.title} - ${String(e.episode).padStart(2, '0')} [${e.resolution}p]`).replace(/\.mkv$/i, '')
        const finalTitle = `${baseTitle} ${ddlTag}.mkv`

        // 1. Si ya tiene torrent pre-vinculado en el catálogo
        if (e.torrentPath && /^[a-f0-9]{40}$/i.test(e.infoHash)) {
          results.push({
            series: s,
            episode: e,
            title: finalTitle,
            link: new URL(e.torrentPath, INDEX_URL).href,
            hash: e.infoHash,
            size: e.size || 0,
            date: new Date(),
            seeders: e.isOnline === false ? 0 : 50,
            leechers: 1,
            downloads: 200,
            accuracy: 'high'
          })
        } else {
          // 2. Resolución dinámica en tiempo real vía AnimeTosho
          const tosho = await fetchAnimeToshoTorrent(s.title, e, fetchFn)
          if (tosho && tosho.info_hash) {
            results.push({
              series: s,
              episode: e,
              title: finalTitle,
              link: tosho.torrent_url || tosho.magnet_uri,
              hash: tosho.info_hash,
              size: tosho.total_size || e.size || 0,
              date: new Date(tosho.timestamp ? tosho.timestamp * 1000 : Date.now()),
              seeders: Math.max(tosho.seeders || 0, 50),
              leechers: tosho.leechers || 1,
              downloads: 300,
              accuracy: 'high'
            })
          }
        }
      }
    }

    const filtered = results.filter(r => !exclusions.some(x => r.title.toLowerCase().includes(x)))
    const requestedRes = String(query.resolution ?? '').replace(/p$/i, '')
    if (requestedRes) {
      const preferred = filtered.filter(r => String(r.episode.resolution) === requestedRes)
      if (preferred.length) return preferred
    }

    return filtered
  }

  async batch() { return [] }
  async movie() { return [] }
}
