// Unwrap only destinations explicitly present in known catalogue wrappers.
// This does not follow redirects or contact a shortener over the network.
export function directUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let candidate = value.trim()
  const seen = new Set()

  for (let depth = 0; depth < 8; depth++) {
    let parsed
    try {
      parsed = new URL(candidate)
    } catch {
      return null
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (seen.has(parsed.href)) return null
    seen.add(parsed.href)

    let target
    if (parsed.hostname === 'ouo.io') {
      target = parsed.searchParams.get('s')
    } else if (parsed.hostname === 'redirect.japan-paw.net') {
      target = parsed.hash.slice(1)
    } else {
      if (parsed.hostname === 'anibatchddl.com' || parsed.hostname.endsWith('.anibatchddl.com')) {
        parsed.hostname = parsed.hostname.replace('anibatchddl.com', 'craftervault.com')
      }
      return parsed.href
    }

    if (!target) return null
    candidate = target.trim()
    // Decode an encoded destination, but preserve escapes in an already
    // absolute URL (signed queries and encoded slashes must remain intact).
    for (let decoding = 0; decoding < 3 && !/^https?:\/\//i.test(candidate); decoding++) {
      let decoded
      // Published mixed encoding escapes only the scheme; retain path escapes.
      try { decoded = /^https?%3a%2f%2f/i.test(candidate) && candidate.includes('/')
        ? candidate.replace(/^(https?)%3a%2f%2f/i, '$1://')
        : decodeURIComponent(candidate) } catch { return null }
      if (decoded === candidate) break
      candidate = decoded.trim()
    }
  }
  return null
}
