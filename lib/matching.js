export const VIDEO = /\.(mkv|mp4|webm|avi|m4v)$/i
export const normalize = value => String(value ?? '').normalize('NFKD').toLowerCase()
  .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')
export const crc = value => String(value ?? '').match(/\[([a-f\d]{8})\]/i)?.[1].toUpperCase()
export const resolution = value => String(value ?? '').match(/(?:^|[^\d])(2160|1080|720|540|480)p?(?=$|[^\d])/i)?.[1]
export function fileName(ep) {
  try {
    const name = decodeURIComponent(new URL(ep.url).pathname.split('/').pop())
    if (VIDEO.test(name)) return name
  } catch {}
  return ep.fileName || ''
}
const canonicalFile = value => String(value ?? '').normalize('NFC').toLowerCase().trim()
export function episodeNumber(value) {
  const text = String(value ?? '').replace(/\[[^\]]*\]/g, ' ')
  const tagged = text.match(/(?:\bS\d+[ ._-]*)?\b(?:E|EP|Episode)[ ._-]*0*(\d+(?:\.\d+)?)(?=\b|v\d)/i)
    ?? text.match(/\bS\d+E0*(\d+(?:\.\d+)?)(?=\b|v\d)/i)
  if (tagged) return Number(tagged[1])
  // A separator is required: numbers in titles, seasons, years and codecs are not episodes.
  const separated = text.match(/\s-\s*0*(\d{1,3}(?:\.\d+)?)(?:v\d+)?(?=\s|\.[a-z]|$)/i)
  return separated ? Number(separated[1]) : null
}
export function seasonNumber(value) {
  const text = String(value ?? '')
  const match = text.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/i)
    ?? text.match(/\bseason\s*(\d+)\b/i)
    ?? text.match(/\bS0*(\d+)(?:E\d+|\b)/i)
  if (match) return Number(match[1])
  const roman = text.match(/\b(II|III|IV|V)\s*$/)
  return roman ? { II: 2, III: 3, IV: 4, V: 5 }[roman[1]] : 1
}
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] !== b[j - 1]))
    row = next
  }
  return row[b.length]
}
export function matchSeries(catalog, titles = [], id) {
  const byId = id ? catalog.filter(s => Number(s.anilistId) === Number(id)) : []
  if (byId.length) return byId
  const available = catalog.filter(s => !id || !s.anilistId)
  const wanted = titles.filter(t => normalize(t))
  const names = s => [s.title, ...(s.aliases ?? [])].filter(Boolean)
  const exact = available.filter(s => names(s).some(n => wanted.some(t => normalize(n) === normalize(t))))
  if (exact.length) return exact
  const fuzzy = available.filter(s => names(s).some(n => wanted.some(t => {
    const a = normalize(n), b = normalize(t)
    return a.length >= 6 && b.length >= 6 && seasonNumber(n) === seasonNumber(t) && editDistance(a, b) <= 1
  })))
  // An ambiguous typo must not select a different series/season.
  return fuzzy.length === 1 ? fuzzy : []
}
export function sameRelease(ep, name) {
  const expected = fileName(ep)
  if (!expected || !name) return false
  const aCrc = crc(expected) || ep.crc32?.toUpperCase(), bCrc = crc(name)
  if (aCrc && bCrc && aCrc !== bCrc) return false
  const aRes = resolution(expected) || String(ep.resolution || ''), bRes = resolution(name)
  if (aRes && bRes && aRes !== bRes) return false
  const aEp = episodeNumber(expected), bEp = episodeNumber(name)
  if (aEp !== null && bEp !== null && aEp !== bEp) return false
  const codec = text => /\b(hevc|x265|h[ .]?265)\b/i.test(text) ? 'hevc' : /\b(avc|x264|h[ .]?264)\b/i.test(text) ? 'avc' : null
  if (codec(expected) && codec(name) && codec(expected) !== codec(name)) return false
  const group = text => String(text).match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase()
  const aGroup = ep.group?.toLowerCase() || group(expected), bGroup = group(name)
  if (aGroup && bGroup && aGroup !== bGroup) return false
  if (canonicalFile(expected) === canonicalFile(name)) return true
  const core = value => normalize(value.replace(/\[[^\]]*\]/g, '').replace(/\.(mkv|mp4|webm|avi|m4v)$/i, ''))
  // CRC alone is only 32 bits: also require the same title/episode stem.
  if (Boolean(aCrc && bCrc && aCrc === bCrc && core(expected) && core(expected) === core(name))) return true
  // Si uno de los lados no tiene CRC pero coinciden grupo, resolución, episodio y núcleo del nombre
  if (aGroup && bGroup && aGroup === bGroup && core(expected) && core(expected) === core(name)) return true
  return false
}
export function isBatchTorrent(item) {
  if (Array.isArray(item.files)) return item.files.filter(f => VIDEO.test(f.name || f.path || '')).length > 1
  const title = `${item.title || ''} ${item.torrent_name || ''}`
  return /\b(batch|complete\s+(?:series|season)|season\s*\d*\s*complete)\b|(?:^|[\s[(])\d{1,3}\s*[-~]\s*\d{1,3}(?=[\s\])]|$)/i.test(title)
}
export function onlineState(ep, now = Date.now()) {
  const checked = Date.parse(ep.checkedAt)
  if (!Number.isFinite(checked) || checked > now || now - checked > 86_400_000) return null
  return typeof ep.isOnline === 'boolean' ? ep.isOnline : null
}

export function scoreCandidate(itemTitle, targetEp, siblingEps = []) {
  let score = 0
  const title = String(itemTitle || '').toLowerCase()
  const targetFn = fileName(targetEp).toLowerCase()

  const extractGroup = text => {
    const m = String(text || '').match(/^\[([^\]]+)\]/) || String(text || '').match(/-([A-Za-z0-9_-]+)(?:\.(mkv|mp4|avi))?$/i)
    if (!m) return null
    const g = m[1].trim().toLowerCase()
    if (/^(japan[- ]?pa?s?w|web|bd|1080p|720p|480p)/i.test(g)) return null
    return g
  }

  const targetGroup = targetEp.group?.toLowerCase() || extractGroup(targetFn) || (targetEp.quality ? extractGroup(targetEp.quality) : null)
  if (targetGroup) {
    if (title.includes(targetGroup)) score += 60
    else score -= 30
  }

  for (const s of siblingEps) {
    const sGroup = s.group?.toLowerCase() || extractGroup(s.fileName || s.sourceFileName)
    if (sGroup && title.includes(sGroup)) {
      score += 40
      break
    }
  }

  const isCR = /\b(cr|crunchyroll)\b/i.test(targetFn)
  const isAMZN = /\b(amzn|amazon)\b/i.test(targetFn)
  const isBILI = /\b(bili|bilibili)\b/i.test(targetFn)
  const isNF = /\b(nf|netflix)\b/i.test(targetFn)
  const isBD = /\b(bd|bluray|blu-ray)\b/i.test(targetFn)

  if (isCR) {
    if (/\b(cr|crunchyroll)\b/i.test(title)) score += 35
    if (/\b(amzn|bili|netflix|nf|hidive)\b/i.test(title)) score -= 45
  } else if (isAMZN) {
    if (/\b(amzn|amazon)\b/i.test(title)) score += 35
    if (/\b(cr|bili|netflix|nf)\b/i.test(title)) score -= 45
  } else if (isBILI) {
    if (/\b(bili|bilibili)\b/i.test(title)) score += 35
    if (/\b(cr|amzn|netflix)\b/i.test(title)) score -= 45
  } else if (isBD) {
    if (/\b(bd|bluray|blu-ray)\b/i.test(title)) score += 35
    if (/\b(web|web-dl|webrip)\b/i.test(title)) score -= 35
  }

  const targetIsDual = /\b(dual|dual-audio|multi-audio|dub)\b/i.test(targetFn)
  const candIsDual = /\b(dual|dual-audio|multi-audio|dub)\b/i.test(title)
  if (targetIsDual && candIsDual) score += 25
  else if (!targetIsDual && candIsDual) score -= 50

  const targetIsHevc = /\b(hevc|x265|h[ .]?265)\b/i.test(targetFn)
  const targetIsAvc = /\b(avc|x264|h[ .]?264)\b/i.test(targetFn)
  const targetIsAv1 = /\bav1\b/i.test(targetFn)

  const candIsHevc = /\b(hevc|x265|h[ .]?265)\b/i.test(title)
  const candIsAvc = /\b(avc|x264|h[ .]?264)\b/i.test(title)
  const candIsAv1 = /\bav1\b/i.test(title)

  if (targetIsHevc) {
    if (candIsHevc) score += 20
    if (candIsAvc || candIsAv1) score -= 30
  } else if (targetIsAvc) {
    if (candIsAvc) score += 20
    if (candIsHevc || candIsAv1) score -= 30
  } else if (targetIsAv1) {
    if (candIsAv1) score += 20
    if (candIsHevc || candIsAvc) score -= 30
  }

  const cleanTargetWords = targetFn.replace(/\.(mkv|mp4|webm|avi|m4v)$/i, '').split(/[^a-z0-9]+/i).filter(w => w.length > 2)
  for (const w of cleanTargetWords) {
    if (title.includes(w)) score += 2
  }

  return score
}

export function rankCandidates(items, targetEp, siblingEps = []) {
  const targetNum = Number(targetEp.episode)
  const wantedRes = resolution(fileName(targetEp)) || String(targetEp.resolution || '')

  const valid = items.filter(item => {
    if (!item.torrent_url || isBatchTorrent(item)) return false
    if (Number(item.num_files) === 1 && Number(targetEp.size) > 0 && Number(item.total_size) > 0 && Number(item.total_size) !== Number(targetEp.size)) return false
    const num = episodeNumber(item.title)
    if (num !== null && num !== targetNum) return false
    const res = resolution(item.title)
    if (res && wantedRes && res !== wantedRes) return false
    return true
  })

  return valid.map(item => ({
    item,
    score: scoreCandidate(item.title, targetEp, siblingEps)
  })).sort((a, b) => b.score - a.score).map(x => x.item)
}

