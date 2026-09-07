// ESM para el worker de Hayase. build.mjs fija esta URL.
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

function extractCrc32(str) {
  const m = String(str ?? '').match(/\[([0-9A-Fa-f]{8})\]/)
  return m ? m[1].toUpperCase() : null
}

function extractGroup(str) {
  const m = String(str ?? '').match(/^\[([^\]]+)\]/)
  return m ? m[1].trim() : null
}

const VIDEO_EXTENSIONS = /\.(mkv|mp4|webm|avi|m4v)$/i

function resolveFile(query, file, catalog) {
  if (!file || !file.name || !VIDEO_EXTENSIONS.test(file.name)) return undefined

  const fileName = file.name
  const torrentName = query.name || ''
  const targetEpisode = Number(query.episode)

  // 1. Filtrar series candidatas por ID o títulos
  const titles = (query.titles ?? []).map(normalize).filter(Boolean)
  const byId = query.anilistId ? catalog.filter(s => Number(s.anilistId) === Number(query.anilistId)) : []

  let candidateSeries = byId.length ? byId : catalog.filter(s => {
    const sTitle = normalize(s.title)
    if (titles.some(t => t === sTitle || t.includes(sTitle) || sTitle.includes(t))) return true
    if (s.aliases && Array.isArray(s.aliases)) {
      if (s.aliases.some(a => titles.includes(normalize(a)))) return true
    }
    const combined = normalize(`${torrentName} ${fileName}`)
    if (sTitle && combined.includes(sTitle)) return true
    return false
  })

  if (!candidateSeries.length) {
    candidateSeries = catalog.filter(s => {
      const sTitle = normalize(s.title)
      return sTitle && normalize(fileName).includes(sTitle)
    })
  }

  if (!candidateSeries.length) return undefined

  // 2. Extraer metadatos de la consulta para scoring
  const fileCrc = extractCrc32(fileName)
  const fileGroup = extractGroup(fileName) || extractGroup(torrentName)
  const fileHas1080 = /1080/i.test(`${fileName} ${torrentName}`)
  const fileHas720 = /720/i.test(`${fileName} ${torrentName}`)

  // 3. Buscar y puntuar episodios candidatos
  let bestCandidate = null
  let bestScore = -1

  for (const series of candidateSeries) {
    const episodes = (series.episodes ?? []).filter(e => Number(e.episode) === targetEpisode)

    for (const ep of episodes) {
      let score = 0

      const epCrc = ep.crc32 || extractCrc32(ep.fileName || ep.url)
      const epGroup = ep.group || extractGroup(ep.fileName || '')
      const epRes = String(ep.resolution || '')

      // Penalización definitiva: grupos o CRC32 incompatibles no deben mezclarse
      // para evitar errores de SHA-1 en WebTorrent
      if (fileCrc && epCrc && fileCrc !== epCrc) continue
      if (fileGroup && epGroup && normalize(fileGroup) !== normalize(epGroup)) {
        continue
      }

      // Prioridad 1: Coincidencia exacta de nombre de archivo
      if (ep.fileName && (file.name === ep.fileName || normalize(file.name) === normalize(ep.fileName))) {
        score += 1000
      }

      // Prioridad 2: Coincidencia de CRC32
      if (fileCrc && epCrc && fileCrc === epCrc) {
        score += 500
      }

      // Prioridad 3: Coincidencia de grupo
      if (fileGroup && epGroup && normalize(fileGroup) === normalize(epGroup)) {
        score += 200
      }

      // Prioridad 4: Coincidencia de resolución
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
