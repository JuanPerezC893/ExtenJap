import { readFileSync, readdirSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { resolve, dirname, relative, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { fileName, episodeNumber, resolution, seasonNumber, isBatchTorrent, rankCandidates } from './lib/matching.js'
import { validateLinkedTorrent } from './lib/link-validation.js'
import { searchNyaa, searchAnimeTosho, searchAniSearch, searchNekoBT, buildSearchQueries } from './lib/sources.js'
import { createIndexerNetwork } from './lib/indexer-network.js'
import { directUrl } from './lib/direct-url.js'
import { isMain } from './lib/io.mjs'
import { parseSeries } from './scrape.mjs'
export { searchNyaa, searchAnimeTosho, searchAniSearch, searchNekoBT }

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, typeof value === 'string' || value instanceof Uint8Array ? value : JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path)
}
function readState(path, fallback) {
  if (!existsSync(path)) return fallback
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Esquema inválido')
    return value
  } catch (err) {
    const backup = `${path}.corrupt.${Date.now()}`
    copyFileSync(path, backup)
    throw new Error(`Error crítico al leer ${path}. Copia conservada en ${backup}: ${err.message}`)
  }
}
export function loadVerifiedMatches(stateDir = '.') {
  const data = readState(resolve(stateDir, 'verified-matches.json'), { series: {} })
  if (!data.series || typeof data.series !== 'object' || Array.isArray(data.series)) throw new Error('Registro sin objeto series; no se sobrescribirá')
  return data
}
export function saveVerifiedMatches(data, stateDir = '.') {
  data.updatedAt = new Date().toISOString()
  atomicWrite(resolve(stateDir, 'verified-matches.json'), data)
}
function inside(root, path) {
  const target = resolve(root, path), rel = relative(resolve(root), target)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Ruta fuera del directorio de resultados')
  return target
}
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sourceFingerprint = ep => digest([ep.url, fileName(ep), Number(ep.episode), String(ep.resolution || ''), ep.size || null, ep.quality || '', ep.group || ''])
export const releaseKey = (series, ep) => digest([series.anilistId || series.id || series.title, sourceFingerprint(ep)])
export function episodeReleaseMatch(entry, ep) {
  if (Number(entry.episode) !== Number(ep.episode) || String(entry.resolution || '') !== String(ep.resolution || '')) return false
  return Boolean(entry.directUrl && (directUrl(entry.directUrl) === directUrl(ep.url) || directUrl(entry.sourceUrl) === directUrl(ep.url)))
}
const failure = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
const errorData = err => ({ code: err.code || (err.name === 'AbortError' ? 'ABORTED' : err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR'), message: err.message, status: err.status, provider: err.provider, retryAt: err.retryAt || null, stage: err.stage || null, host: (() => { try { return new URL(err.url).hostname } catch { return null } })() })

// Evidence for sampled pieces only, never a claim that every byte was checked.
export async function verifyPieceHashes(url, parsed, fetchFn = fetch, options = {}) {
  if (!Number.isSafeInteger(parsed.length) || parsed.length <= 0 || !Number.isSafeInteger(parsed.pieceLength) || parsed.pieceLength <= 0 || parsed.pieces?.length !== Math.ceil(parsed.length / parsed.pieceLength)) return false
  if (parsed.pieceLength > 32 * 1024 * 1024) throw failure('PIECE_BUDGET', 'Pieza mayor al presupuesto de 32 MiB; requiere revisión')
  const evidence = []
  const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
  for (const index of new Set([0, Math.floor(parsed.pieces.length / 2), parsed.pieces.length - 1])) {
    options.signal?.throwIfAborted()
    const start = index * parsed.pieceLength, end = Math.min(start + parsed.pieceLength, parsed.length) - 1
    const res = await fetchFn(url, { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity', 'User-Agent': BROWSER_UA, 'Accept': '*/*', 'Referer': 'https://emision.craftervault.com/' }, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), maxBodyBytes: end - start + 1, requiredStatus: 206 })
    const range = res.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i)
    if (res.status !== 206 || !range || Number(range[1]) !== start || Number(range[2]) !== end) {
      await res.body?.cancel?.()
      throw failure('RANGE_UNAVAILABLE', `El servidor no entregó el rango solicitado (HTTP ${res.status})`, { status: res.status })
    }
    if (Number(range[3]) !== parsed.length) { await res.body?.cancel?.(); return false }
    const piece = new Uint8Array(await res.arrayBuffer())
    if (piece.length !== end - start + 1) throw failure('TRUNCATED_RANGE', 'La respuesta Range llegó incompleta')
    const sha1 = createHash('sha1').update(piece).digest('hex')
    if (sha1 !== parsed.pieces[index].toLowerCase()) return false
    evidence.push({ index, start, end, sha1 })
  }
  return options.evidence ? { method: 'sha1-samples', totalSize: parsed.length, pieceLength: parsed.pieceLength, pieces: evidence, checkedAt: new Date().toISOString() } : true
}
export function createSearchCache() {
  const entries = new Map()
  return async (key, action) => {
    if (entries.has(key)) return entries.get(key)
    const pending = Promise.resolve().then(action)
    entries.set(key, pending)
    try { const value = await pending; if (entries.size > 500) entries.delete(entries.keys().next().value); return value }
    catch (err) { entries.delete(key); throw err }
  }
}
export function boundedQueries(series, ep, maxQueries, siblings = [], siblingOnly = false) {
  const plans = [], seen = new Set()
  for (const q of buildSearchQueries(series, { ...ep, fileName: fileName(ep) }, siblings)) {
    if (siblingOnly && q.priority !== 'sibling') continue
    const providers = q.provider === 'all' ? (q.priority === 'crc' ? ['anisearch', 'animetosho'] : ['animetosho', 'anisearch']) : [q.provider]
    for (const provider of providers) {
      const key = provider + ':' + q.query
      if (!seen.has(key)) { seen.add(key); plans.push({ provider, query: q.query }) }
    }
  }
  return { plans: plans.slice(0, maxQueries), truncated: plans.length > maxQueries }
}

const fatalDisk = err => ['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO'].includes(err.code)

async function stageRequest(action, stage, url) {
  try { return await action() }
  catch (err) {
    err.stage ||= stage
    if (!err.url) err.url = url
    throw err
  }
}

export async function probeDirectVideo(url, fetchFn, signal) {
  const res = await stageRequest(() => fetchFn(url, {
    headers: { Range: 'bytes=0-0', 'Accept-Encoding': 'identity' },
    signal, maxBodyBytes: 1, requiredStatus: 206
  }), 'video_probe', url)
  const match = res.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/i)
  if (res.status !== 206 || !match || Number(match[1]) < 1 || (await res.arrayBuffer()).byteLength !== 1) {
    await res.body?.cancel?.().catch(() => {})
    throw failure('RANGE_UNAVAILABLE', 'El video no responde con Range de un byte', { stage: 'video_probe', url, status: res.status })
  }
  return Number(match[1])
}

async function downloadTorrentBuffer(item, fetchFn, signal, network) {
  const url = item.torrent_url
  return stageRequest(async () => {
    const res = await fetchFn(url, { signal, maxBodyBytes: 4 * 1024 * 1024 })
    if (!res.ok) throw failure('HTTP_ERROR', `Descarga de torrent: HTTP ${res.status}`, { status: res.status })
    const bytes = new Uint8Array(await res.arrayBuffer())
    let parsed
    try { parsed = await parseTorrent(bytes) }
    catch {
      const err = failure('INVALID_RESPONSE', 'La respuesta de descarga no contiene metadatos torrent válidos', { url, status: res.status })
      network?.noteFailure(url, err)
      throw err
    }
    if (item.info_hash && parsed.infoHash !== String(item.info_hash).toLowerCase()) throw failure('TORRENT_HASH_MISMATCH', 'El torrent descargado no corresponde al infohash del resultado', { url })
    return bytes
  }, 'torrent_download', url)
}

async function resolveRelease(series, ep, options) {
  const { fetchFn, signal, stateDir = '.', verifyPieces = true, maxQueries = 4, maxCandidates = 4, searchCache = createSearchCache(), existing, siblings = [], network } = options
  const errors = [], rejections = [], seen = new Set()
  let candidates = 0, incompatible = 0, searched = 0
  let url = directUrl(existing?.sourceFingerprint === sourceFingerprint(ep) ? existing.directUrl : ep.url)
  if (!url) throw failure('INVALID_DIRECT_URL', 'URL de video inválida')
  // Check the data path before spending tracker requests. A 403 here is access,
  // not evidence about whether a compatible torrent exists.
  if (verifyPieces) {
    try {
      const actualSize = await probeDirectVideo(url, fetchFn, signal)
      if (ep.size && Number(ep.size) !== actualSize) return { status: 'needs_review', reason: 'SOURCE_SIZE_CHANGED', searched, candidates, errors: [], actualSize }
    } catch (err) {
      if (signal?.aborted) throw err
      if ([404, 410].includes(err.status)) {
        // Refresh the published source once per series/run; never guess storage paths.
        if (Number.isInteger(Number(series.sourceV)) && Number(series.sourceV) > 0) {
          const pageUrl = `https://paste.japan-paw.net/?v=${Number(series.sourceV)}`
          try {
            const published = await searchCache(`source:${pageUrl}`, () => stageRequest(async () => {
              const response = await fetchFn(pageUrl, { signal, maxBodyBytes: 4 * 1024 * 1024 })
              const parsed = parseSeries(await response.text())
              if (!parsed) throw failure('INVALID_RESPONSE', 'Página de origen no reconocida')
              return parsed
            }, 'source_refresh', pageUrl))
            const replacements = [...new Set(published.episodes.filter(e => fileName(e) === fileName(ep) && Number(e.episode) === Number(ep.episode) && String(e.resolution) === String(ep.resolution)).map(e => directUrl(e.url)).filter(u => u && u !== url))]
            if (replacements.length === 1) {
              url = replacements[0]
              const actualSize = await probeDirectVideo(url, fetchFn, signal)
              if (ep.size && Number(ep.size) !== actualSize) return { status: 'needs_review', reason: 'SOURCE_SIZE_CHANGED', searched, candidates, actualSize }
            } else return { status: 'needs_review', reason: 'SOURCE_NOT_FOUND', searched, candidates, errors: [errorData(err)] }
          } catch (refreshError) {
            if (signal?.aborted) throw refreshError
            if (refreshError.url) network?.noteFailure(refreshError.url, refreshError)
            return { status: [404, 410].includes(refreshError.status) ? 'needs_review' : 'deferred', reason: [404, 410].includes(refreshError.status) ? 'SOURCE_NOT_FOUND' : 'SOURCE_REFRESH_FAILED', searched, candidates, errors: [errorData(err), errorData(refreshError)], retryAt: refreshError.retryAt || Date.now() + 60000 }
          }
        } else return { status: 'needs_review', reason: 'SOURCE_NOT_FOUND', searched, candidates, errors: [errorData(err)] }
      } else return { status: 'deferred', reason: err.code || 'NETWORK_ERROR', searched, candidates, incompatible: 0, errors: [errorData(err)], retryAt: err.retryAt || Date.now() + 60000 }
    }
  }
  const tryTorrent = async (bytes, source) => {
    const parsed = await parseTorrent(bytes)
    validateLinkedTorrent(parsed, ep, { allowSampleMatch: verifyPieces })
    let evidence = null
    if (verifyPieces) {
      evidence = await stageRequest(() => verifyPieceHashes(url, parsed, fetchFn, { signal, evidence: true }), 'video_pieces', url)
      if (!evidence) { incompatible++; return null }
    }
    parsed.urlList = [url]
    // A different mirror gets a separate container; the content infohash is unchanged.
    const torrentPath = `torrents/${parsed.infoHash}-${digest(url).slice(0, 16)}.torrent`
    atomicWrite(inside(resolve(stateDir, 'dist'), torrentPath), toTorrentFile(parsed))
    return { directUrl: url, infoHash: parsed.infoHash, size: parsed.length, torrentFileName: parsed.files[0].name, torrentPath, piecesVerified: Boolean(evidence), evidence, matchedBy: source, title: parsed.name }
  }
  for (const record of [existing, ep]) {
    if (!record?.torrentPath || seen.has(record.torrentPath)) continue
    seen.add(record.torrentPath)
    const path = inside(resolve(stateDir, 'dist'), record.torrentPath)
    if (!existsSync(path)) continue
    try { const match = await tryTorrent(readFileSync(path), 'saved-torrent'); if (match) return { status: 'prepared', match, searched, candidates, rejections } }
    catch (err) {
      if (fatalDisk(err)) throw err
      const isNetwork = ['RANGE_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'HOST_COOLDOWN', 'HTTP_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'BODY_TOO_LARGE', 'INVALID_RESPONSE', 'TRUNCATED_RANGE'].includes(err.code) || err.name === 'AbortError' || err.name === 'IndexerNetworkError'
      if (isNetwork) errors.push(errorData(err))
      else if (err.code) errors.push(errorData(err))
      else incompatible++
    }
  }
  const searchMap = {
    nyaa: searchNyaa,
    animetosho: searchAnimeTosho,
    anisearch: searchAniSearch,
    nekobt: searchNekoBT
  }
  const { plans, truncated } = boundedQueries(series, ep, maxQueries, siblings, options.siblingOnly)
  for (const plan of plans) {
    signal?.throwIfAborted()
    let items
    try {
      searched++
      const searchFn = searchMap[plan.provider] || searchAnimeTosho
      items = await searchCache(`${plan.provider}:${plan.query}`, () => searchFn(plan.query, fetchFn, { signal }))
    } catch (err) {
      if (err.url) network?.noteFailure(err.url, err)
      err.stage ||= 'search'
      errors.push(errorData(err)); continue
    }
    const candidatesToTest = rankCandidates(items, ep, siblings)
    for (const item of candidatesToTest) {
      signal?.throwIfAborted()
      if (!item.torrent_url || seen.has(item.torrent_url)) continue
      seen.add(item.torrent_url)
      const downloadHost = new URL(item.torrent_url).hostname
      const pause = network?.snapshot().hosts?.[downloadHost]
      if (Number(pause?.retryAt) > Date.now()) {
        errors.push({ code: 'HOST_COOLDOWN', stage: 'torrent_download', host: downloadHost, status: pause.lastStatus, retryAt: pause.retryAt })
        continue
      }
      if (candidates >= maxCandidates) break
      candidates++
      try {
        const bytes = await downloadTorrentBuffer(item, fetchFn, signal, network)
        const match = await tryTorrent(bytes, item.source || plan.provider)
        if (!match) {
          rejections.push('sha1_mismatch')
          continue
        }
        return { status: 'prepared', match, searched, candidates, rejections }
      } catch (err) {
        if (fatalDisk(err)) throw err
        if (err.stage === 'torrent_download' && [401, 404, 410].includes(err.status)) {
          rejections.push(`TORRENT_UNAVAILABLE:${err.status}`)
          continue
        }
        const isNetwork = ['RANGE_UNAVAILABLE', 'TIMEOUT', 'NETWORK_ERROR', 'HOST_COOLDOWN', 'HTTP_ERROR', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE', 'BODY_TOO_LARGE', 'INVALID_RESPONSE', 'TRUNCATED_RANGE'].includes(err.code) || err.name === 'AbortError' || err.name === 'IndexerNetworkError'
        if (isNetwork) {
          errors.push(errorData(err))
          rejections.push(err.status ? `${err.code || 'HTTP_ERROR'}:${err.status}` : (err.code || 'NETWORK_ERROR'))
        } else {
          incompatible++
          rejections.push(`${err.code || 'validation'}:${err.message}`)
        }
      }
    }
    if (candidates >= maxCandidates) break
  }
  const details = { searched, candidates, incompatible, errors, rejections, searchLimited: truncated || candidates >= maxCandidates }
  const networkFailure = errors.length > 0
  if (networkFailure) {
    const mainErr = errors.find(e => ['HOST_COOLDOWN', 'HTTP_ERROR', 'RANGE_UNAVAILABLE', 'RATE_LIMITED'].includes(e.code)) || errors[0]
    return { ...details, status: 'deferred', reason: mainErr.code, retryAt: Math.max(Date.now() + 60000, ...errors.map(e => e.retryAt || 0)) }
  }
  return { ...details, status: incompatible ? 'incompatible' : 'not_found', reason: incompatible ? 'SAMPLED_OR_METADATA_MISMATCH' : 'NO_MATCH_IN_SEARCH_BUDGET', retryAt: Date.now() + 86400000 }
}
export async function findAndPrepareTorrent(series, ep, options = {}) {
  const signal = options.signal || AbortSignal.timeout(120000)
  const network = options.network || createIndexerNetwork({ fetchFn: options.fetchFn || fetch, signal })
  const result = await resolveRelease(series, ep, { ...options, fetchFn: network.fetch, signal, network })
  if (options.detailed) return result
  if (result.status === 'deferred') throw failure(result.reason, 'La búsqueda quedó diferida por un fallo de acceso', { retryAt: result.retryAt, details: result })
  return result.match || null
}
function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

export function acquireLock(stateDir, log = console.log, { force = false } = {}) {
  const path = resolve(stateDir, 'indexer.lock')
  if (force && existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf8')
      const lockData = JSON.parse(raw)
      const sameHost = !lockData.hostname || lockData.hostname === hostname()
      if (sameHost && typeof lockData.pid === 'number' && lockData.pid !== process.pid) {
        try { process.kill(lockData.pid, 'SIGKILL') } catch {}
      }
    } catch {}
    try { unlinkSync(path) } catch {}
  }
  let fd
  try { fd = openSync(path, 'wx') } catch (err) {
    if (err.code !== 'EEXIST') throw err
    let stale = false
    let lockData = null
    try {
      const raw = readFileSync(path, 'utf8')
      lockData = JSON.parse(raw)
      const sameHost = !lockData.hostname || lockData.hostname === hostname()
      if (sameHost && typeof lockData.pid === 'number' && !isProcessAlive(lockData.pid)) {
        stale = true
      } else if (lockData.startedAt && Date.now() - new Date(lockData.startedAt).getTime() > 4 * 3600000) {
        stale = true
      }
    } catch {
      try {
        const stats = statSync(path)
        if (Date.now() - stats.mtimeMs > 10000) stale = true
      } catch {}
    }
    if (stale) {
      const desc = lockData?.pid ? `PID ${lockData.pid}` : 'archivo residual/vacío'
      if (log) log(`[Indexer] Se detectó un bloqueo huérfano (${desc} no activo). Reclamando indexer.lock...`)
      try { unlinkSync(path) } catch {}
      try {
        fd = openSync(path, 'wx')
      } catch (retryErr) {
        if (retryErr.code !== 'EEXIST') throw retryErr
        throw new Error(`Ya existe ${path}. No ejecutes dos indexadores sobre el mismo estado. Si la sesión anterior terminó abruptamente, comprueba que esté detenida antes de retirar ese archivo.`)
      }
    } else {
      const hostInfo = lockData?.hostname && lockData.hostname !== hostname() ? ` en el host "${lockData.hostname}"` : ''
      const pidInfo = lockData?.pid ? ` (proceso activo PID ${lockData.pid}${hostInfo})` : ''
      throw new Error(`Ya existe ${path}${pidInfo}. No ejecutes dos indexadores sobre el mismo estado. Si la sesión anterior terminó abruptamente, comprueba que esté detenida antes de retirar ese archivo.`)
    }
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() }))
  closeSync(fd)
  return () => {
    try { unlinkSync(path) } catch {}
  }
}
function episodeIssue(series, ep, conflictingIds) {
  if (conflictingIds.has(String(series.anilistId))) return 'ANILIST_SEASON_CONFLICT'
  const number = episodeNumber(fileName(ep))
  if (!Number.isFinite(Number(ep.episode)) || Number(ep.episode) < 0) return 'INVALID_EPISODE'
  if (number !== null && number !== Number(ep.episode)) return 'EPISODE_NUMBER_MISMATCH'
  if (!directUrl(ep.url)) return 'INVALID_DIRECT_URL'
  return null
}
export async function runIndexer(options = {}) {
  const defaultCatalog = existsSync('raw-catalog.json') ? 'raw-catalog.json' : 'dist/indexed-catalog.json'
  const { seriesFilter = [], verifyPieces = true, limit = Infinity, concurrency = 2, useProxy = false, proxyFile = null, batchRange = null, includeNonAnime = false, retryPending = false, forceLock = false, maxQueries = 4, maxCandidates = 4, maxMinutes = 15, stateDir: requestedDir = '.', catalogPath = defaultCatalog, signal: parentSignal, fetchFn = fetch, networkOptions = {}, log = console.log, intervalMs = null } = options
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error('concurrency debe ser un entero de 1 a 16')
  if (intervalMs !== null && (!Number.isInteger(intervalMs) || intervalMs < 0)) throw new Error('interval-ms debe ser un entero mayor o igual a 0')
  if (!(limit === Infinity || Number.isInteger(limit) && limit > 0) || !Number.isFinite(maxMinutes) || maxMinutes <= 0 || !Number.isInteger(maxQueries) || maxQueries < 1 || !Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error('Límites inválidos')
  if (useProxy && !proxyFile) throw new Error('--proxy requiere --proxy-file; no se cargarán listas públicas automáticamente')
  const stateDir = resolve(requestedDir)
  mkdirSync(stateDir, { recursive: true })
  const releaseLock = acquireLock(stateDir, log, { force: forceLock })
  let pool
  try {
    const catalog = JSON.parse(readFileSync(resolve(catalogPath), 'utf8'))
    if (!Array.isArray(catalog)) throw new Error('Catálogo inválido')
    const registry = loadVerifiedMatches(stateDir)
    const statePath = resolve(stateDir, 'indexer-state.json')
    const state = readState(statePath, { version: 1, jobs: {}, providers: {} })
    if (state.version !== 1 || !state.jobs || typeof state.jobs !== 'object' || Array.isArray(state.jobs)) throw new Error('Estado de reanudación incompatible')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(failure('TIME_BUDGET', 'Fin del presupuesto de tiempo')), maxMinutes * 60000)
    const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal
    try {
      let trackerFetch = fetchFn
      if (useProxy) {
        const { ProxyPool } = await import('./lib/proxy-pool.js')
        pool = new ProxyPool({ enabled: true, proxyFile, strictProxy: true, maxRetries: 0, timeoutMs: 20000 }); await pool.warmup(15, 100, { signal })
        trackerFetch = (url, opts) => pool.fetch(url, opts, 0)
      }
      const initialProviders = state.providers
      const proxiedHosts = ['paste.japan-paw.net', 'nyaa.si', 'feed.animetosho.xyz', 'animetosho.xyz', 'feed.animetosho.org', 'animetosho.org', 'storage.animetosho.org', 'api.anisearch.org', 'nekobt.to', 'emision.craftervault.com', 'craftervault.com', 'emision.anibatchddl.com', 'anibatchddl.com']
      const network = createIndexerNetwork({
        concurrencyPerHost: Math.max(2, Math.min(concurrency, 16)),
        minIntervalMs: intervalMs ?? (concurrency > 2 ? 300 : 600),
        ...networkOptions,
        hostPolicies: { 'nyaa.si': { concurrency: 1, minIntervalMs: 1500 }, 'paste.japan-paw.net': { concurrency: 1, minIntervalMs: 1000 }, ...networkOptions.hostPolicies },
        fetchFn: (url, opts) => {
          const hostname = new URL(url).hostname.toLowerCase()
          const shouldProxy = useProxy && proxiedHosts.some(h => hostname === h || hostname.endsWith('.' + h))
          return shouldProxy ? trackerFetch(url, opts) : fetchFn(url, opts)
        },
        signal,
        initialState: initialProviders
      })
      const cache = createSearchCache()
      // One directory listing avoids thousands of per-file Drive/FUSE checks.
      const torrentDir = resolve(stateDir, 'dist', 'torrents')
      const savedTorrents = new Set(existsSync(torrentDir) ? readdirSync(torrentDir).map(name => resolve(torrentDir, name)) : [])
      const report = { startedAt: new Date().toISOString(), selected: 0, attempted: 0, prepared: 0, reused: 0, deferred: 0, not_found: 0, incompatible: 0, needs_review: 0, postponed: 0, rescueAttempted: 0, stopReason: 'complete' }
      const checkpoint = () => {
        saveVerifiedMatches(registry, stateDir)
        state.providers = network.snapshot(); state.updatedAt = new Date().toISOString()
        atomicWrite(statePath, state)
        atomicWrite(resolve(stateDir, 'indexer-report.json'), { ...report, updatedAt: state.updatedAt, providers: state.providers })
      }
      const seasons = new Map()
      for (const s of catalog) if (s.anilistId) {
        const key = String(s.anilistId)
        if (!seasons.has(key)) seasons.set(key, new Set())
        seasons.get(key).add(seasonNumber(s.title))
      }
      const conflictingIds = new Set([...seasons].filter(([, values]) => values.size > 1).map(([key]) => key))
      let selected = includeNonAnime ? catalog : catalog.filter(s => s.anilistId)
      if (batchRange) selected = selected.slice(...batchRange)
      if (seriesFilter.length) selected = selected.filter(s => seriesFilter.some(f => /^\d+$/.test(String(f)) ? String(s.anilistId) === String(f) : [s.title, ...(s.aliases || [])].some(t => t?.toLowerCase().includes(String(f).toLowerCase()))))
      const tasks = [], seen = new Set()
      for (const series of selected) for (const ep of series.episodes || []) {
        const key = releaseKey(series, ep)
        if (!seen.has(key)) { seen.add(key); tasks.push({ series, ep, key }) }
      }
      report.selected = tasks.length
      log(`[Indexer v0.5.6] Indexación: ${selected.length} series, ${tasks.length} archivos; ${concurrency} trabajadores; máximo ${maxQueries} consultas y ${maxCandidates} candidatos por archivo.`)
      const processed = new Set()
      const rescueReserve = Number.isFinite(limit) && limit >= 3 ? Math.min(100, Math.max(1, Math.floor(limit / 10))) : 0
      const workLimit = limit - rescueReserve
      let cursor = 0, stop = false, fatal
      const blockedProviders = () => {
        const hosts = network.snapshot().hosts || {}
        const activeProviders = ['api.anisearch.org', 'feed.animetosho.xyz']
        return activeProviders.every(h => Number(hosts[h]?.retryAt || hosts[h]?.cooldownUntil) > Date.now())
      }
      async function worker(id) {
        while (cursor < tasks.length && !stop && !signal.aborted) {
          if (report.attempted >= workLimit) { report.stopReason = 'limit'; break }
          if (blockedProviders()) { report.stopReason = 'providers_unavailable'; stop = true; break }
          const { series, ep, key } = tasks[cursor++]
          const sId = String(series.anilistId || series.id || series.title), priorJob = state.jobs[key]
          if (!retryPending && priorJob && priorJob.status !== 'prepared' && !(priorJob.status === 'deferred' && Number(priorJob.retryAt || 0) <= Date.now())) { report.postponed++; continue }
          const stamp = { series: series.title, anilistId: series.anilistId, episode: ep.episode, resolution: ep.resolution, fileName: fileName(ep), updatedAt: new Date().toISOString(), attempts: (priorJob?.attempts || 0) + 1 }
          const issue = episodeIssue(series, ep, conflictingIds)
          if (issue) {
            report.attempted++; state.jobs[key] = { ...stamp, status: 'needs_review', reason: issue }
            report.needs_review++; checkpoint(); continue
          }
          const seriesRecord = registry.series[sId] ||= { title: series.title, anilistId: series.anilistId ?? null, episodes: [] }
          const existing = seriesRecord.episodes.find(e => episodeReleaseMatch(e, ep))
          const priorMetadata = existing || seriesRecord.episodes.find(e => Number(e.episode) === Number(ep.episode) && (e.sourceFileName || e.fileName) === fileName(ep))
          let reusable = false
          if (existing && episodeReleaseMatch(existing, ep) && existing.torrentPath && (!verifyPieces || existing.verified?.piecesVerified) && (!existing.sourceFingerprint || existing.sourceFingerprint === sourceFingerprint(ep))) {
            if (existing.verified?.piecesVerified && existing.infoHash && existing.size) {
              reusable = savedTorrents.has(inside(resolve(stateDir, 'dist'), existing.torrentPath))
            } else {
              try {
                const parsed = await parseTorrent(readFileSync(inside(resolve(stateDir, 'dist'), existing.torrentPath)))
                validateLinkedTorrent(parsed, ep, { allowSampleMatch: existing.verified?.piecesVerified === true })
                reusable = parsed.infoHash === existing.infoHash && parsed.length === existing.size && parsed.urlList.includes(directUrl(existing.directUrl))
              } catch {}
            }
          }
          if (reusable) {
            report.reused++
            state.jobs[key] = { ...stamp, status: 'prepared', reused: true }
            if (report.reused % 500 === 0) {
              log(`[Indexer] Reanudando... ${report.reused} archivos previos reutilizados`)
            }
            continue
          }
          const videoHost = new URL(directUrl(ep.url)).hostname
          const hostState = network.snapshot().hosts?.[videoHost]
          if (Number(hostState?.retryAt) > Date.now()) {
            const leftSec = Math.max(1, Math.ceil((Number(hostState.retryAt) - Date.now()) / 1000))
            log(`[Indexer] El host de video "${videoHost}" tiene una pausa temporal activa (${leftSec}s restantes).`)
            report.stopReason = 'video_host_unavailable'; stop = true; break
          }
          // Reused entries do not consume the budget; repeated --limit runs advance.
          if (report.attempted >= workLimit) { report.stopReason = 'limit'; break }
          report.attempted++
          processed.add(key)
          log(`[W${id}] ${series.title} · ${ep.episode} · ${ep.resolution || '?'}p`)
          let result
          try {
            const verifiedSiblings = seriesRecord.episodes.filter(e => e.verified?.piecesVerified)
            result = await resolveRelease(series, ep, { stateDir, existing: priorMetadata, siblings: verifiedSiblings, verifyPieces, fetchFn: network.fetch, signal, network, searchCache: cache, maxQueries, maxCandidates })
          }
          catch (err) {
            if (signal.aborted) { report.stopReason = parentSignal?.aborted ? 'interrupted' : 'time_budget'; result = { status: 'deferred', reason: report.stopReason, retryAt: Date.now() } }
            else if (err.code && !fatalDisk(err)) result = { status: 'deferred', reason: err.code, errors: [errorData(err)], retryAt: Date.now() + 60000 }
            else throw err
          }
          if (result.match) {
            const m = result.match
            const entry = { episode: ep.episode, resolution: String(ep.resolution || ''), quality: ep.quality, fileName: m.torrentFileName, sourceFileName: fileName(ep), sourceFingerprint: sourceFingerprint(ep), directUrl: m.directUrl || ep.url, sourceUrl: ep.url, infoHash: m.infoHash, size: m.size, torrentPath: m.torrentPath, verified: { matchedBy: m.matchedBy, piecesVerified: m.piecesVerified, verifiedAt: new Date().toISOString(), evidence: m.evidence }, isOnline: m.piecesVerified ? true : null, checkedAt: m.evidence?.checkedAt }
            const idx = seriesRecord.episodes.findIndex(e => episodeReleaseMatch(e, ep))
            if (idx >= 0) seriesRecord.episodes[idx] = entry
            else seriesRecord.episodes.push(entry)
            registry.series[sId] = seriesRecord
          }
          const { match, ...outcome } = result
          state.jobs[key] = { ...stamp, ...outcome }; report[result.status]++
          log(`[W${id}] ${result.status}${result.reason ? ': ' + result.reason : ''}${result.match ? ' (piezas muestreadas)' : ''}${result.errors?.length ? ' [' + result.errors.slice(0, 3).map(e => [e.stage, e.host, e.status ? 'HTTP ' + e.status : e.code].filter(Boolean).join(' / ')).join('; ') + ']' : ''}`)
          if (result.rejections?.length) log(`[W${id}] Descartes: ${[...new Set(result.rejections)].slice(0, 3).join('; ')}`)
          checkpoint()
        }
      }
      await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1).catch(err => { fatal ||= err; stop = true; controller.abort(err) })))
      if (fatal) throw fatal
      if (!signal.aborted && ['complete', 'limit'].includes(report.stopReason) && report.attempted < limit) {
        const rescueCandidates = []
        for (const { series, ep, key } of tasks) {
          const sId = String(series.anilistId || series.id || series.title)
          const job = state.jobs[key]
          if (processed.has(key) && job && ['incompatible', 'not_found'].includes(job.status)) {
            const seriesRecord = registry.series[sId]
            const verifiedSiblings = seriesRecord?.episodes?.filter(e => e.verified?.piecesVerified && Number(e.episode) !== Number(ep.episode)) || []
            if (verifiedSiblings.length > 0) {
              rescueCandidates.push({ series, ep, key, sId, seriesRecord, verifiedSiblings, priorJob: job })
            }
          }
        }
        if (rescueCandidates.length > 0) {
          const rescueConcurrency = Math.min(concurrency, rescueCandidates.length)
          log(`[Indexer] Ejecutando pase de rescate intra-serie para ${rescueCandidates.length} archivo(s) con ${rescueConcurrency} trabajadores...`)
          let rescueCursor = 0
          async function rescueWorker(wId) {
            while (rescueCursor < rescueCandidates.length && !signal.aborted && report.rescueAttempted < Math.min(100, limit - report.attempted)) {
              const { series, ep, key, sId, seriesRecord, verifiedSiblings, priorJob } = rescueCandidates[rescueCursor++]
              report.rescueAttempted++
              try {
                const res = await resolveRelease(series, ep, {
                  stateDir,
                  existing: priorJob,
                  siblings: verifiedSiblings,
                  siblingOnly: true,
                  verifyPieces,
                  fetchFn: network.fetch,
                  signal,
                  network,
                  searchCache: cache,
                  maxQueries: Math.min(maxQueries, 2),
                  maxCandidates
                })
                if (res.status === 'prepared' && res.match) {
                  const m = res.match
                  const entry = { episode: ep.episode, resolution: String(ep.resolution || ''), quality: ep.quality, fileName: m.torrentFileName, sourceFileName: fileName(ep), sourceFingerprint: sourceFingerprint(ep), directUrl: m.directUrl || ep.url, sourceUrl: ep.url, infoHash: m.infoHash, size: m.size, torrentPath: m.torrentPath, verified: { matchedBy: m.matchedBy, piecesVerified: m.piecesVerified, verifiedAt: new Date().toISOString(), evidence: m.evidence }, isOnline: m.piecesVerified ? true : null, checkedAt: m.evidence?.checkedAt }
                  const sRec = registry.series[sId] ||= { title: series.title, anilistId: series.anilistId ?? null, episodes: [] }
                  const idx = sRec.episodes.findIndex(e => episodeReleaseMatch(e, ep))
                  if (idx >= 0) sRec.episodes[idx] = entry
                  else sRec.episodes.push(entry)
                  registry.series[sId] = sRec
                  log(`[Rescate] ${series.title} · ${ep.episode} -> prepared`)
                }
                const { match, ...outcome } = res
                state.jobs[key] = { ...priorJob, ...outcome, updatedAt: new Date().toISOString(), attempts: (priorJob.attempts || 0) + 1, rescued: true }
                report[priorJob.status]--
                report[res.status]++
                checkpoint()
              } catch (err) {
                if (signal.aborted) break
                throw err
              }
            }
          }
          await Promise.all(Array.from({ length: rescueConcurrency }, (_, i) => rescueWorker(i + 1).catch(err => { fatal ||= err; controller.abort(err) })))
          if (fatal) throw fatal
        }
      }
      if (signal.aborted && report.stopReason === 'complete') report.stopReason = parentSignal?.aborted ? 'interrupted' : 'time_budget'
      report.remaining = tasks.length - report.attempted - report.reused - report.postponed; report.finishedAt = new Date().toISOString(); checkpoint()
      log(`Tanda finalizada (${report.stopReason}): ${report.prepared} preparados, ${report.reused} reutilizados, ${report.deferred} diferidos por acceso, ${report.not_found} sin coincidencia en el presupuesto, ${report.incompatible} incompatibles, ${report.needs_review} para revisar. Restantes: ${report.remaining}.`)
      return report
    } finally { clearTimeout(timeout) }
  } finally { try { await pool?.close() } finally { releaseLock() } }
}
export function parseIndexerArgs(args) {
  const out = { seriesFilter: [] }
  const numbers = { '--concurrency': 'concurrency', '--limit': 'limit', '--max-minutes': 'maxMinutes', '--max-queries': 'maxQueries', '--max-candidates': 'maxCandidates', '--interval-ms': 'intervalMs' }
  const strings = { '--state-dir': 'stateDir', '--catalog': 'catalogPath', '--proxy-file': 'proxyFile' }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = () => { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Falta valor para ${arg}`); return args[++i] }
    if (numbers[arg]) {
      const n = Number(value())
      if (!Number.isFinite(n) || (arg === '--interval-ms' ? n < 0 : n <= 0) || arg !== '--max-minutes' && !Number.isInteger(n)) throw new Error(`Valor inválido para ${arg}`)
      out[numbers[arg]] = n
    } else if (strings[arg]) out[strings[arg]] = value()
    else if (arg === '--batch') {
      const start = Number(value()), end = Number(value())
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) throw new Error('Rango --batch inválido')
      out.batchRange = [start, end]
    } else if (arg === '--series') {
      out.seriesFilter.push(value())
      while (args[i + 1] && !args[i + 1].startsWith('--')) out.seriesFilter.push(args[++i])
    } else if (arg === '--proxy') out.useProxy = true
    else if (arg === '--retry-pending') out.retryPending = true
    else if (arg === '--force-lock') out.forceLock = true
    else if (arg === '--include-non-anime') out.includeNonAnime = true
    else if (arg === '--no-pieces') out.verifyPieces = false
    else if (arg === '--pieces') out.verifyPieces = true
    else throw new Error(`Opción desconocida: ${arg}`)
  }
  return out
}
if (isMain(import.meta.url)) {
  const controller = new AbortController()
  const stop = () => { console.warn('Interrupción: guardando avances y cancelando solicitudes…'); controller.abort() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  try {
    const report = await runIndexer({ ...parseIndexerArgs(process.argv.slice(2)), signal: controller.signal })
    process.exitCode = report.stopReason === 'interrupted' ? 130 : ['providers_unavailable', 'video_host_unavailable'].includes(report.stopReason) || report.deferred > 0 ? 2 : 0
  } catch (err) { console.error(err.message); process.exitCode = 1 }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop) }
}
