import parseTorrent from 'parse-torrent'

// Cache raw immutable metadata, never a torrent after a video's urlList was added.
export function createTorrentCache({ maxBytes = 32 * 1024 * 1024, maxEntries = 128 } = {}) {
  const entries = new Map(), rejected = new Set()
  let bytes = 0
  const stats = { downloads: 0, hits: 0, unsupported: 0 }
  return {
    stats,
    rejected: url => rejected.has(url),
    async load(url, action) {
      if (entries.has(url)) { stats.hits++; return entries.get(url).promise }
      const entry = { size: 0 }
      entry.promise = Promise.resolve().then(async () => {
        stats.downloads++
        const buffer = await action()
        const parsed = await parseTorrent(buffer)
        if (parsed.files.length !== 1 || !/\.(mkv|mp4|webm|avi|m4v)$/i.test(parsed.files[0].name)) {
          rejected.add(url)
          if (rejected.size > 2048) rejected.delete(rejected.values().next().value)
          stats.unsupported++
          throw Object.assign(new Error('El torrent no contiene un único archivo de vídeo'), { code: 'UNSUPPORTED_TORRENT' })
        }
        entry.size = buffer.byteLength; bytes += entry.size
        for (const [key, candidate] of entries) {
          if (bytes <= maxBytes && entries.size <= maxEntries) break
          if (!candidate.size) continue
          entries.delete(key); bytes -= candidate.size
        }
        return buffer
      }).catch(error => {
        if (entries.get(url) === entry) { entries.delete(url); bytes -= entry.size }
        throw error
      })
      entries.set(url, entry)
      return entry.promise
    }
  }
}
