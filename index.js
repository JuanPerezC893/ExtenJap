// ESM para el worker de Hayase. build.mjs fija esta URL.
const INDEX_URL = 'http://127.0.0.1:8787/indexed-catalog.json'
let cache
let cachedAt = 0
const normalize = value => String(value ?? '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
async function loadIndex(fetchFn, refresh = false) {
  if (!refresh && cache && Date.now() - cachedAt < 300_000) return cache
  const response = await fetchFn(INDEX_URL)
  if (!response.ok) throw new Error(`No se pudo cargar el catálogo: HTTP ${response.status}`)
  const data = await response.json()
  if (!Array.isArray(data) || data.some(s => !s.title || !Array.isArray(s.episodes))) throw new Error('Catálogo inválido')
  cache = data
  cachedAt = Date.now()
  return data
}
export default new class JapanPawDirect {
  async test() { await loadIndex(fetch, true); return true }
  async single(query) {
    const catalog = await loadIndex(query.fetch ?? fetch)
    const titles = (query.titles ?? []).map(normalize).filter(Boolean)
    const byId = query.anilistId && catalog.filter(s => Number(s.anilistId) === Number(query.anilistId))
    const series = byId?.length ? byId : catalog.filter(s =>
      (!s.anilistId || Number(s.anilistId) === Number(query.anilistId)) &&
      [s.title, ...(s.aliases ?? [])].some(t => titles.includes(normalize(t))))
    const exclusions = (query.exclusions ?? []).map(x => String(x).toLowerCase()).filter(Boolean)
    const results = series.flatMap(s => s.episodes
      .filter(e => e.episode === Number(query.episode) && e.torrentPath && /^[a-f0-9]{40}$/i.test(e.infoHash))
      .map(e => ({ ...e, series: s, title: e.fileName || `${s.title} - ${String(e.episode).padStart(2, '0')} ${e.quality}` })))
      .filter(e => !exclusions.some(x => `${e.title} ${e.quality}`.toLowerCase().includes(x)))
    const resolution = String(query.resolution ?? '').replace(/p$/i, '')
    const preferred = results.filter(e => String(e.resolution) === resolution)
    return (preferred.length ? preferred : results).map(e => ({
      title: e.title, link: new URL(e.torrentPath, INDEX_URL).href,
      hash: e.infoHash, size: e.size, date: new Date(e.hashedAt),
      seeders: 0, leechers: 0, downloads: 0, accuracy: e.series.anilistId ? 'medium' : 'low'
    }))
  }
  async batch() { return [] }
  async movie() { return [] }
}
