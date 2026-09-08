// ESM para el worker de Hayase (TorrentSource).
const INDEX_URL = 'http://127.0.0.1:8787/indexed-catalog.json'
let cache
let cachedAt = 0

const strip = str => String(str ?? '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/\p{M}/gu, '')
  .replace(/[^a-z0-9]+/g, '')

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

function isBatchTorrent(item) {
  const title = `${item.title || ''} ${item.torrent_name || ''}`.toLowerCase()
  // Detección de patrones explícitos de paquetes/temporadas completas (01-12, batch, etc.)
  if (/\b(batch|unofficial\s*batch|season\s*\d*\s*complete|complete\s*season|complete\s*series|s\d+\s*-\s*s\d+|0?1\s*-\s*\d{2,}|0?1\s*~\s*\d{2,})\b/i.test(title)) {
    return true
  }
  // Si el torrent contiene múltiples archivos de video (temporada completa con > 3 archivos)
  // Las películas o episodios individuales (incluso de 10 GB, 20 GB o 4K REMUX) tienen 1 único archivo principal
  if (item.num_files && item.num_files > 3) {
    return true
  }
  return false
}

function matchSeries(catalog, titles, anilistId) {
  if (anilistId) {
    const byId = catalog.filter(s => Number(s.anilistId) === Number(anilistId))
    if (byId.length) return byId
  }

  const cleanTitles = titles.map(strip).filter(Boolean)
  if (!cleanTitles.length) return []

  return catalog.filter(s => {
    const sClean = strip(s.title)
    if (!sClean) return false

    for (const qClean of cleanTitles) {
      // 1. Coincidencia exacta sin espacios ni puntuación (ej. Himekishi vs Hime Kishi)
      if (qClean === sClean) return true

      // 2. Coincidencia por alias si existen
      if (s.aliases && Array.isArray(s.aliases)) {
        if (s.aliases.some(a => strip(a) === qClean)) return true
      }

      // 3. Substring seguro: SOLO si ambos tienen 6 o más caracteres
      // (Evita que títulos cortos como "K", "Ajin" o "TEST" coincidan con cualquier palabra)
      if (qClean.length >= 6 && sClean.length >= 6) {
        if (sClean.includes(qClean) || qClean.includes(sClean)) return true
      }

      // 4. Coincidencia con nombre en inglés en los nombres de archivo
      if (s.episodes && s.episodes.length > 0) {
        const fn = strip(s.episodes[0].fileName || '')
        if (qClean.length >= 6 && fn.includes(qClean)) return true
      }
    }
    return false
  })
}

async function fetchAnimeToshoTorrent(seriesTitle, ep, fetchFn) {
  try {
    const cleanTitle = seriesTitle.replace(/[!?:;,.'"()[\]-]/g, ' ').replace(/\s+/g, ' ').trim()
    const epNum = Math.floor(Number(ep.episode))
    const epStr = String(epNum).padStart(2, '0')
    
    let items = null
    const q1 = encodeURIComponent(`${cleanTitle} ${epStr}`)
    const res1 = await fetchFn(`https://feed.animetosho.org/json?q=${q1}`, {
      headers: { 'User-Agent': 'Hayase-JapanPaw/1.0' },
      signal: AbortSignal.timeout(4000)
    })
    if (res1.ok) {
      const data = await res1.json()
      if (Array.isArray(data) && data.length) items = data
    }

    // Para películas o especiales de 1 solo episodio, el tracker suele no incluir "01"
    if ((!items || !items.length) && epNum === 1) {
      const q2 = encodeURIComponent(cleanTitle)
      const res2 = await fetchFn(`https://feed.animetosho.org/json?q=${q2}`, {
        headers: { 'User-Agent': 'Hayase-JapanPaw/1.0' },
        signal: AbortSignal.timeout(4000)
      })
      if (res2.ok) {
        const data = await res2.json()
        if (Array.isArray(data) && data.length) items = data
      }
    }

    if (!items || !items.length) return null

    // Filtrar batches (temporadas completas) para capítulos individuales y películas
    const singles = items.filter(i => !isBatchTorrent(i))
    const pool = singles.length ? singles : items

    // 1. Prioridad máxima: match exacto por CRC32
    if (ep.crc32) {
      const match = pool.find(i => i.title && i.title.toUpperCase().includes(ep.crc32.toUpperCase()))
      if (match?.info_hash && match?.torrent_url) return match
    }

    // 2. Prioridad: match exacto por nombre de archivo
    if (ep.fileName) {
      const cleanFn = strip(ep.fileName.replace(/\.mkv$/i, ''))
      const match = pool.find(i => {
        const iClean = strip(i.title || '')
        return iClean.includes(cleanFn) || cleanFn.includes(iClean)
      })
      if (match?.info_hash && match?.torrent_url) return match
    }

    // 3. Prioridad: match por fansub group
    if (ep.group) {
      const match = pool.find(i => i.title && i.title.toLowerCase().includes(ep.group.toLowerCase()))
      if (match?.info_hash && match?.torrent_url) return match
    }

    // 4. Match por resolución
    const resStr = `${ep.resolution}p`
    const matchRes = pool.find(i => i.title && i.title.includes(resStr))
    if (matchRes?.info_hash && matchRes?.torrent_url) return matchRes

    // 5. Primer resultado individual que tenga torrent_url e info_hash
    return pool.find(i => i.info_hash && i.torrent_url) || null
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
    const titles = query.titles ?? []
    const series = matchSeries(catalog, titles, query.anilistId)

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
