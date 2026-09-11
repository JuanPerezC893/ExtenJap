import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

const QUERY = `query($ids:[Int]) { Page(page:1,perPage:50) { media(id_in:$ids,type:ANIME) { id coverImage { large } bannerImage description(asHtml:false) genres startDate { year } duration siteUrl } } }`

const norm = s => String(s || '').toLowerCase().replace(/[:\-_!?.·,]/g, ' ').replace(/\s+/g, ' ').trim()

export function createMetadata({ fetchFn = fetch, path, log = console.log, interval = 2200, offlineDbPath } = {}) {
  let cache = {}, tail = Promise.resolve(), next = 0, blockedUntil = 0
  let offlineByAnilistId = null, offlineByTitle = null

  const loadOfflineDb = () => {
    if (offlineByAnilistId || !offlineDbPath) return
    offlineByAnilistId = new Map()
    offlineByTitle = new Map()
    try {
      if (!existsSync(offlineDbPath)) return
      const raw = JSON.parse(readFileSync(offlineDbPath, 'utf8'))
      for (const item of raw.data || []) {
        const meta = {}
        if (item.picture) { meta.poster = item.picture; meta.posterShape = 'poster' }
        if (item.thumbnail && !meta.poster) { meta.poster = item.thumbnail; meta.posterShape = 'poster' }
        if (item.picture) meta.background = item.picture
        if (item.tags?.length) meta.genres = item.tags.slice(0, 5)
        if (item.animeSeason?.year) meta.releaseInfo = String(item.animeSeason.year)
        if (item.duration?.value && item.duration?.unit === 'SECONDS') {
          meta.runtime = `${Math.round(item.duration.value / 60)} min`
        }
        for (const s of item.sources || []) {
          const m = s.match(/anilist\.co\/anime\/(\d+)/)
          if (m) offlineByAnilistId.set(Number(m[1]), meta)
        }
        if (item.title) offlineByTitle.set(norm(item.title), meta)
        for (const syn of item.synonyms || []) {
          if (syn) offlineByTitle.set(norm(syn), meta)
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') log(`[Metadatos] Base offline no cargada: ${e.message}`)
    }
  }

  try {
    if (path) {
      const saved = JSON.parse(readFileSync(path, 'utf8'))
      if (saved.version === 1) cache = saved.items || {}
    }
  } catch (e) {
    if (e.code !== 'ENOENT') log('[Metadatos] Caché ilegible; se consultará de nuevo.')
  }

  const save = () => {
    if (!path) return
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path + '.tmp', JSON.stringify({ version: 1, items: cache }))
      renameSync(path + '.tmp', path)
    } catch {
      log('[Metadatos] No se pudo guardar la caché; continúa en memoria.')
    }
  }

  const resolveOffline = (id, title) => {
    if (!offlineDbPath) return null
    loadOfflineDb()
    const numId = Number(id)
    if (Number.isSafeInteger(numId) && numId > 0 && offlineByAnilistId?.has(numId)) {
      return offlineByAnilistId.get(numId)
    }
    const titleKey = title ? norm(title) : null
    if (titleKey && offlineByTitle?.has(titleKey)) {
      return offlineByTitle.get(titleKey)
    }
    return null
  }

  const get = (id, title) => {
    const numId = Number(id)
    const hasNum = Number.isSafeInteger(numId) && numId > 0
    if (hasNum && cache[numId]?.meta) return cache[numId].meta
    const titleKey = title ? norm(title) : null
    if (titleKey && cache[titleKey]?.meta) return cache[titleKey].meta
    const off = resolveOffline(id, title)
    if (off) return off
    return {}
  }

  const fetchExternalFallback = async (row) => {
    const title = row?.title
    if (!title) return null
    const cleanTitle = title.replace(/\s*\(\d{4}(?:\s*-\s*\d{4})?\)\s*$/, '').trim()
    try {
      const r = await fetch(`https://kitsu.io/api/edge/anime?filter[text]=${encodeURIComponent(cleanTitle)}&page[limit]=1`, { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const d = await r.json()
        const attr = d.data?.[0]?.attributes
        if (attr?.posterImage?.large || attr?.posterImage?.original || attr?.posterImage?.medium) {
          const meta = {
            poster: attr.posterImage.large || attr.posterImage.original || attr.posterImage.medium,
            posterShape: 'poster'
          }
          if (attr.coverImage?.large || attr.coverImage?.original) meta.background = attr.coverImage.large || attr.coverImage.original
          if (attr.synopsis || attr.description) meta.description = (attr.synopsis || attr.description).replace(/<[^>]*>/g, '').trim()
          if (attr.startDate) {
            const y = new Date(attr.startDate).getFullYear()
            if (Number.isFinite(y)) meta.releaseInfo = String(y)
          }
          if (attr.episodeLength) meta.runtime = `${attr.episodeLength} min`
          return meta
        }
      }
    } catch {}

    try {
      for (const kind of ['series', 'movie']) {
        const r = await fetch(`https://v3-cinemeta.strem.io/catalog/${kind}/top/search=${encodeURIComponent(cleanTitle)}.json`, { signal: AbortSignal.timeout(5000) })
        if (r.ok) {
          const d = await r.json()
          const m = d.metas?.[0]
          if (m?.poster) {
            const meta = { poster: m.poster, posterShape: m.posterShape || 'poster' }
            if (m.background) meta.background = m.background
            if (m.description) meta.description = m.description
            if (m.genres?.length) meta.genres = m.genres
            if (m.releaseInfo) meta.releaseInfo = String(m.releaseInfo)
            return meta
          }
        }
      }
    } catch {}

    return null
  }

  const ensure = rows => {
    for (const r of rows) {
      const numId = Number(r.anilistId)
      const hasId = Number.isSafeInteger(numId) && numId > 0
      const titleKey = r.title ? norm(r.title) : null
      if ((hasId && cache[numId]?.expires > Date.now()) || (titleKey && cache[titleKey]?.expires > Date.now())) continue
      const off = resolveOffline(r.anilistId, r.title)
      if (off) {
        if (hasId) cache[numId] = { meta: off, expires: Date.now() + 7 * 86400000 }
        if (titleKey) cache[titleKey] = { meta: off, expires: Date.now() + 7 * 86400000 }
      }
    }

    const ids = [...new Set(rows.map(r => Number(r.anilistId)).filter(id => Number.isSafeInteger(id) && id > 0))]
    const task = async () => {
      const missing = ids.filter(id => !(cache[id]?.expires > Date.now()))
      let anilistFailed = false

      if (missing.length > 0) {
        for (let offset = 0; offset < missing.length; offset += 50) {
          if (blockedUntil > Date.now()) { anilistFailed = true; break }
          if (next > Date.now()) await new Promise(resolve => setTimeout(resolve, next - Date.now()))
          const batch = missing.slice(offset, offset + 50)
          try {
            const r = await fetchFn('https://graphql.anilist.co', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ query: QUERY, variables: { ids: batch } }),
              signal: AbortSignal.timeout(12000)
            })
            next = Date.now() + interval
            if (!r.ok) {
              const retry = Number(r.headers.get('retry-after'))
              next = Date.now() + Math.max(60000, Number.isFinite(retry) ? retry * 1000 : 0)
              await r.body?.cancel()
              throw new Error(`HTTP ${r.status}`)
            }
            const data = await r.json()
            if (!Array.isArray(data.data?.Page?.media) || data.errors?.length) throw new Error('Respuesta de AniList inválida')
            const found = new Map(data.data.Page.media.map(m => [m.id, m]))
            for (const id of batch) {
              const m = found.get(id)
              if (!m) { cache[id] = { meta: get(id), expires: Date.now() + 3600000 }; continue }
              const meta = {}
              if (m.coverImage?.large) { meta.poster = m.coverImage.large; meta.posterShape = 'poster' }
              if (m.bannerImage) meta.background = m.bannerImage
              if (m.description) meta.description = m.description.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              if (m.genres?.length) meta.genres = m.genres
              if (m.startDate?.year) meta.releaseInfo = String(m.startDate.year)
              if (m.duration) meta.runtime = `${m.duration} min`
              if (m.siteUrl) meta.links = [{ name: 'AniList', category: 'Más información', url: m.siteUrl }]
              cache[id] = { meta, expires: Date.now() + 7 * 86400000 }
            }
            save()
            if (offset + 50 < missing.length && interval) await new Promise(resolve => setTimeout(resolve, interval))
          } catch (e) {
            blockedUntil = Math.max(next, Date.now() + 60000)
            log(`[Metadatos] ${e.message}; se conserva el catálogo y la reproducción.`)
            anilistFailed = true
            break
          }
        }
      }

      const needFallback = rows.filter(r => {
        const numId = Number(r.anilistId)
        const hasId = Number.isSafeInteger(numId) && numId > 0
        const titleKey = r.title ? norm(r.title) : null
        if (hasId && cache[numId]?.meta?.poster) return false
        if (titleKey && cache[titleKey]?.meta?.poster) return false
        return !!r.title
      })

      if (needFallback.length > 0 && (anilistFailed || needFallback.some(r => !r.anilistId))) {
        if (offlineDbPath || fetchFn === fetch) {
          for (const r of needFallback.slice(0, 15)) {
            const fb = await fetchExternalFallback(r)
            if (fb) {
              const numId = Number(r.anilistId)
              const hasId = Number.isSafeInteger(numId) && numId > 0
              const titleKey = norm(r.title)
              if (hasId) cache[numId] = { meta: fb, expires: Date.now() + 7 * 86400000 }
              if (titleKey) cache[titleKey] = { meta: fb, expires: Date.now() + 7 * 86400000 }
            }
          }
          save()
        }
      }
    }
    const result = tail.then(task)
    tail = result.catch(() => {})
    return result
  }

  return { ensure, get }
}
