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

function getSeasonNumber(title) {
  const t = ' ' + String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' '
  const m2 = t.match(/\b0*(\d+)(?:st|nd|rd|th)\s*season\b/)
  if (m2) return parseInt(m2[1], 10)
  if (/\b(?:iv|4th\s*season)\b/.test(t)) return 4
  if (/\b(?:iii|3rd\s*season)\b/.test(t)) return 3
  if (/\b(?:ii|2nd\s*season)\b/.test(t)) return 2
  const m3 = t.match(/\b(?:part|cour)\s*0*(\d+)\b/)
  if (m3) return parseInt(m3[1], 10)
  const m1 = t.match(/\b(?:season|s)\s*0*(\d{1,2})\b/)
  if (m1) return parseInt(m1[1], 10)
  return 1
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = []
  for (let i = 0; i <= b.length; i++) m[i] = [i]
  for (let j = 0; j <= a.length; j++) m[0][j] = j
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) m[i][j] = m[i - 1][j - 1]
      else m[i][j] = Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1)
    }
  }
  return m[b.length][a.length]
}

function matchSeries(catalog, rawTitles, anilistId) {
  if (anilistId) {
    const byId = catalog.filter(s => Number(s.anilistId) === Number(anilistId))
    if (byId.length) return byId
  }

  const titles = (rawTitles ?? []).filter(Boolean)
  if (!titles.length) return []

  const cleanTitles = titles.map(strip).filter(Boolean)

  return catalog.filter(s => {
    const sClean = strip(s.title)
    if (!sClean) return false
    const sSeason = getSeasonNumber(s.title)

    for (let i = 0; i < titles.length; i++) {
      const qRaw = titles[i]
      const qClean = cleanTitles[i]
      if (!qClean) continue
      const qSeason = getSeasonNumber(qRaw)

      // 1. Coincidencia exacta
      if (qClean === sClean) {
        if (qSeason === sSeason) return true
      }

      // 2. Coincidencia por alias
      if (s.aliases && Array.isArray(s.aliases)) {
        for (const a of s.aliases) {
          if (strip(a) === qClean) return true
        }
      }

      // 3. Fuzzy match para pequeños errores ortográficos / typos (ej. "Taboo Tattoo" vs "Taboo Tatoo")
      if (qClean.length >= 6 && sClean.length >= 6) {
        const maxDist = (qClean.length >= 10 || sClean.length >= 10) ? 2 : 1
        if (levenshtein(qClean, sClean) <= maxDist) {
          if (qSeason === sSeason) return true
        }
      }

      // 4. Subcadena segura (mismo número de temporada)
      if (qClean.length >= 6 && sClean.length >= 6) {
        if (sClean.includes(qClean) || qClean.includes(sClean)) {
          if (qSeason === sSeason) return true
        }
      }

      // 5. Coincidencia con nombre de archivo
      if (s.episodes && s.episodes.length > 0) {
        const fn = strip(s.episodes[0].fileName || '')
        if (qClean.length >= 6 && fn.includes(qClean)) {
          const fnSeason = getSeasonNumber(s.episodes[0].fileName)
          if (qSeason === fnSeason) return true
        }
      }
    }
    return false
  })
}

function extractEpisodeNumber(title) {
  // Ignorar bit-depth (10-bit, 8-bit, 12-bit), resoluciones (1080p, 720p, 480p) y años (19xx, 20xx)
  const clean = String(title || '')
    .replace(/\b\d{1,2}\s*-?\s*bits?\b/gi, '')
    .replace(/\b\d{3,4}p\b/gi, '')
    .replace(/\b(19\d{2}|20\d{2})\b/g, '')

  const m1 = clean.match(/\b(?:s\d+)?\s*(?:e|ep|episode)\s*0*(\d{1,4}(?:\.\d+)?)\b/i)
  if (m1) return parseFloat(m1[1])

  const m2 = clean.match(/(?:[\s\-_]0*(\d{1,4}(?:\.\d+)?)\s*(?:v\d+)?(?:[\s\-_\[(]|\.mkv|\.mp4))/i)
  if (m2) return parseFloat(m2[1])

  return null
}

const toshoCache = new Map()

async function queryAnimeTosho(queryStr, fetchFn) {
  if (toshoCache.has(queryStr)) return toshoCache.get(queryStr)
  try {
    const q = encodeURIComponent(queryStr)
    const res = await fetchFn(`https://feed.animetosho.org/json?q=${q}`, {
      headers: { 'User-Agent': 'Hayase-JapanPaw/1.0' },
      signal: AbortSignal.timeout(4000)
    })
    if (!res.ok) return null
    const data = await res.json()
    if (Array.isArray(data)) {
      toshoCache.set(queryStr, data)
      return data
    }
    return null
  } catch {
    return null
  }
}

async function fetchAnimeToshoTorrent(queryTitles, series, ep, fetchFn) {
  try {
    const epNum = Math.floor(Number(ep.episode))
    const epStr = String(epNum).padStart(2, '0')
    
    // Probar series.title primero (título con el que Japan-Paw nombró los archivos) y luego los títulos de AniList
    const titlesToTry = Array.from(new Set([
      series.title,
      ...((queryTitles || []).filter(t => /[a-z0-9]/i.test(t)))
    ]))

    const targetRes = String(ep.resolution || '').replace(/p$/i, '')
    const targetGroup = (ep.group || '').toLowerCase()
    const targetCrc = (ep.crc32 || '').toUpperCase()
    const targetIsHevc = /\b(hevc|x265|h\.?265)\b/i.test(`${ep.quality || ''} ${ep.fileName || ''}`)

    let bestMatch = null
    let bestScore = -10000

    for (const titleCandidate of titlesToTry) {
      const cleanTitle = titleCandidate.replace(/[!?:;,.'"()[\]-]/g, ' ').replace(/\s+/g, ' ').trim()
      const queries = [`${cleanTitle} ${epStr}`]
      if (epNum === 1) {
        queries.push(cleanTitle)
      }

      for (const qStr of queries) {
        const items = await queryAnimeTosho(qStr, fetchFn)
        if (!items || !items.length) continue

        const singles = items.filter(i => !isBatchTorrent(i))
        const pool = singles.length ? singles : items

        for (const item of pool) {
          if (!item.info_hash || !item.torrent_url) continue
          const itemTitle = (item.title || '').toLowerCase()

          // 1. Validación estricta de episodio: si el torrent indica un número de episodio distinto, descartar
          const torrentEp = extractEpisodeNumber(itemTitle)
          if (torrentEp !== null && torrentEp !== epNum) continue
          if (torrentEp === null && epNum > 1 && !targetCrc && !ep.fileName) continue

          // 2. Validación estricta de resolución: NUNCA asignar 720p a 1080p o viceversa
          const itemIs1080 = /\b1080p?\b/i.test(itemTitle)
          const itemIs720 = /\b720p?\b/i.test(itemTitle)
          const itemIs480 = /\b480p?\b/i.test(itemTitle)

          if (targetRes === '1080' && (itemIs720 || itemIs480)) continue
          if (targetRes === '720' && (itemIs1080 || itemIs480)) continue
          if (targetRes === '480' && (itemIs1080 || itemIs720)) continue

          let score = 0
          if (torrentEp === epNum) score += 3000

          // Coincidencia exacta por CRC32
          if (targetCrc && itemTitle.toUpperCase().includes(targetCrc)) {
            score += 10000
          }

          // Coincidencia por nombre de archivo
          if (ep.fileName) {
            const cleanFn = strip(ep.fileName.replace(/\.mkv$/i, ''))
            const iClean = strip(itemTitle)
            if (iClean.includes(cleanFn) || cleanFn.includes(iClean)) {
              score += 5000
            }
          }

          // Coincidencia por resolución
          if (targetRes === '1080' && itemIs1080) score += 2000
          if (targetRes === '720' && itemIs720) score += 2000
          if (targetRes === '480' && itemIs480) score += 2000

          // Coincidencia por Fansub Group
          if (targetGroup && itemTitle.includes(targetGroup)) {
            score += 1500
          }

          // Codec HEVC vs AVC
          const itemIsHevc = /\b(hevc|x265|h\.?265)\b/i.test(itemTitle)
          if (targetIsHevc === itemIsHevc) score += 500
          else score -= 300

          if (score > bestScore) {
            bestScore = score
            bestMatch = item
          }
        }

        if (bestMatch && bestScore >= 4000) break
      }

      if (bestMatch && bestScore >= 4000) break
    }

    return bestMatch
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
          const tosho = await fetchAnimeToshoTorrent(titles, s, e, fetchFn)
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
