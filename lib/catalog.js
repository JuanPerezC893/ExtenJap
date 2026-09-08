export function catalogLoader(url) {
  let cached, expires = 0, pending
  return async (fetchFn, refresh = false) => {
    if (!refresh && cached && Date.now() < expires) return cached
    if (pending) return pending
    pending = (async () => {
      const response = await fetchFn(url, { signal: AbortSignal.timeout(15_000) })
      if (!response.ok) throw new Error(`Catálogo: HTTP ${response.status}`)
      const data = await response.json()
      if (!Array.isArray(data) || data.some(s => !s.title || !Array.isArray(s.episodes))) throw new Error('Catálogo inválido')
      cached = data
      expires = Date.now() + 300_000
      return data
    })()
    try { return await pending } finally { pending = null }
  }
}
