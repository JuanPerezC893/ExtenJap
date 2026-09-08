import { catalogLoader } from './lib/catalog.js'
import { fileName, sameRelease, matchSeries, episodeNumber, onlineState, VIDEO } from './lib/matching.js'
const INDEX_URL = 'http://127.0.0.1:8787/indexed-catalog.json'

export function resolveFile(query, file, catalog, batch = false) {
  if (!file?.name || !VIDEO.test(file.name)) return undefined
  const series = matchSeries(catalog, query.titles, query.anilistId)
  const candidates = []
  // Batch files have their own episode numbers; query.episode describes the search, not each file.
  const number = batch ? episodeNumber(file.name) : Number(query.episode)
  for (const s of series) {
    for (const ep of s.episodes || []) {
      if (number !== null && Number.isFinite(number) && Number(ep.episode) !== number) continue
      if (!sameRelease(ep, file.name) || onlineState(ep) === false) continue
      try { if (!['http:', 'https:'].includes(new URL(ep.url).protocol)) continue } catch { continue }
      candidates.push(ep)
    }
  }
  if (!candidates.length) return undefined
  // Prefer the exact filename when CRC-only matches are ambiguous.
  const exact = candidates.filter(ep => fileName(ep) === file.name)
  const chosen = exact.length ? exact : candidates
  if (new Set(chosen.map(ep => fileName(ep))).size > 1) return undefined
  return { url: chosen[0].url, index: file.index }
}
export function createHTTPSource(indexUrl = INDEX_URL) {
  const load = catalogLoader(indexUrl)
  return {
    async test() { await load(fetch, true); return true },
    async single(query) { return resolveFile(query, query.file, await load(query.fetch ?? fetch)) },
    async batch(query) {
      const catalog = await load(query.fetch ?? fetch)
      return (query.files || []).map(file => resolveFile(query, file, catalog, true)).filter(Boolean)
    }
  }
}
export default createHTTPSource()
