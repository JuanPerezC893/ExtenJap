// ESM para el worker de Hayase (WebSeedSource).
const INDEX_URL = "https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/indexed-catalog.json"
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

function extractCrc32(str) {
  const m = String(str ?? '').match(/\[([0-9A-Fa-f]{8})\]/)
  return m ? m[1].toUpperCase() : null
}

function extractGroup(str) {
  const m = String(str ?? '').match(/^\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

const VIDEO_EXTENSIONS = /\.(mkv|mp4|webm|avi|m4v)$/i

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

function resolveFile(query, file, catalog) {
  if (!file || !file.name || !VIDEO_EXTENSIONS.test(file.name)) return undefined

  const fileName = file.name
  const torrentName = query.name || ''
  let targetEpisode = Number(query.episode)
  if (isNaN(targetEpisode) || targetEpisode === 0) {
    const m = fileName.match(/(?:[\s\-_]0*(\d{1,4}(?:\.\d+)?)[\s\-_]|E0*(\d{1,4}))/i) ||
              torrentName.match(/(?:[\s\-_]0*(\d{1,4}(?:\.\d+)?)[\s\-_]|E0*(\d{1,4}))/i)
    if (m) targetEpisode = parseFloat(m[1] || m[2])
  }

  const titles = (query.titles ?? []).filter(Boolean)
  const candidateSeries = matchSeries(catalog, [...titles, torrentName, fileName], query.anilistId)
  if (!candidateSeries.length) return undefined

  const fileCrc = extractCrc32(fileName)
  const fileGroup = extractGroup(fileName) || extractGroup(torrentName)
  const fileHas1080 = /1080/i.test(`${fileName} ${torrentName}`)
  const fileHas720 = /720/i.test(`${fileName} ${torrentName}`)

  let bestCandidate = null
  let bestScore = -1

  for (const series of candidateSeries) {
    const episodes = (series.episodes ?? []).filter(e => isNaN(targetEpisode) || Number(e.episode) === targetEpisode)

    for (const ep of episodes) {
      let score = 0

      const epCrc = ep.crc32 || extractCrc32(ep.fileName || ep.url)
      const epGroup = ep.group || extractGroup(ep.fileName || '')
      const epRes = String(ep.resolution || '')

      if (fileCrc && epCrc && fileCrc !== epCrc) continue
      if (fileGroup && epGroup && strip(fileGroup) !== strip(epGroup)) continue

      if (ep.fileName && (file.name === ep.fileName || strip(file.name) === strip(ep.fileName))) {
        score += 1000
      }
      if (fileCrc && epCrc && fileCrc === epCrc) {
        score += 500
      }
      if (fileGroup && epGroup && strip(fileGroup) === strip(epGroup)) {
        score += 200
      }
      if (fileHas1080 && epRes === '1080') score += 100
      else if (fileHas720 && epRes === '720') score += 100
      else if (!fileHas1080 && !fileHas720 && epRes === '1080') score += 50

      if (score > bestScore) {
        bestScore = score
        bestCandidate = ep
      }
    }
  }

  if (bestCandidate && bestScore >= 0) {
    if (bestCandidate.isOnline === false) return undefined
    return {
      url: bestCandidate.url,
      index: file.index
    }
  }

  return undefined
}

export default new class JapanPawDirect {
  async test() {
    const data = await loadIndex(fetch, true)
    return Array.isArray(data)
  }

  async single(query, options) {
    const catalog = await loadIndex(query.fetch ?? fetch)
    return resolveFile(query, query.file, catalog)
  }

  async batch(query, options) {
    const catalog = await loadIndex(query.fetch ?? fetch)
    const files = query.files ?? []
    const results = []

    for (const file of files) {
      const res = resolveFile(query, file, catalog)
      if (res) results.push(res)
    }

    return results
  }
}
