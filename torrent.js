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

export default new class JapanPawTorrentSource {
  async test() {
    const data = await loadIndex(fetch, true)
    return Array.isArray(data)
  }

  async single(query) {
    const catalog = await loadIndex(query.fetch ?? fetch)
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

    const results = series.flatMap(s => (s.episodes ?? [])
      .filter(e => Number(e.episode) === targetEpisode && e.torrentPath && /^[a-f0-9]{40}$/i.test(e.infoHash))
      .map(e => {
        const ddlTag = e.isOnline === false ? '[⚠️ DDL Caído - Solo P2P]' : '[⚡ DDL Japan-Paw]'
        const baseTitle = (e.fileName || `${s.title} - ${String(e.episode).padStart(2, '0')} [${e.resolution}p]`).replace(/\.mkv$/i, '')
        const finalTitle = `${baseTitle} ${ddlTag}.mkv`

        return {
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
        }
      })
    ).filter(r => !exclusions.some(x => r.title.toLowerCase().includes(x)))

    const requestedRes = String(query.resolution ?? '').replace(/p$/i, '')
    if (requestedRes) {
      const preferred = results.filter(r => String(r.episode.resolution) === requestedRes)
      if (preferred.length) return preferred
    }

    return results
  }

  async batch() { return [] }
  async movie() { return [] }
}
