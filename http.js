// ESM para el worker de Hayase (WebSeedSource).
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

function extractCrc32(str) {
  const m = String(str ?? '').match(/\[([0-9A-Fa-f]{8})\]/)
  return m ? m[1].toUpperCase() : null
}

function extractGroup(str) {
  const m = String(str ?? '').match(/^\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

const VIDEO_EXTENSIONS = /\.(mkv|mp4|webm|avi|m4v)$/i

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
      if (qClean === sClean) return true
      if (s.aliases && Array.isArray(s.aliases)) {
        if (s.aliases.some(a => strip(a) === qClean)) return true
      }
      if (qClean.length >= 6 && sClean.length >= 6) {
        if (sClean.includes(qClean) || qClean.includes(sClean)) return true
      }
      if (s.episodes && s.episodes.length > 0) {
        const fn = strip(s.episodes[0].fileName || '')
        if (qClean.length >= 6 && fn.includes(qClean)) return true
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
