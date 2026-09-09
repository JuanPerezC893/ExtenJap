import fs from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import parseTorrent from 'parse-torrent'
import { ProxyPool } from './lib/proxy-pool.js'
import { createIndexerNetwork } from './lib/indexer-network.js'
import { directUrl } from './lib/direct-url.js'
import { probeDirectVideo } from './indexer.mjs'
import { isMain } from './lib/io.mjs'

export function findSampleVideo(stateDir = '.') {
  const verifiedPath = resolve(stateDir, 'verified-matches.json')
  if (!fs.existsSync(verifiedPath)) return null
  try {
    const data = JSON.parse(fs.readFileSync(verifiedPath, 'utf8'))
    let fallback = null
    for (const s of Object.values(data.series || {})) {
      for (const ep of s.episodes || []) {
        if (ep.directUrl && ep.torrentPath) {
          const fullTorrentPath = resolve(stateDir, 'dist', ep.torrentPath)
          if (fs.existsSync(fullTorrentPath)) {
            const candidate = { videoUrl: ep.directUrl, torrentPath: fullTorrentPath, title: `${s.title} · ${ep.episode}` }
            if (ep.directUrl.includes('emision.craftervault.com')) return candidate
            if (!fallback) fallback = candidate
          }
        }
      }
    }
    return fallback
  } catch {
    return null
  }
}

// Same source and advertised filters as FreeProxy(https=True, elite=True).
// Source: https://github.com/jundymek/free-proxy/blob/master/fp/fp.py
export function parseProxyCandidates(html) {
  const candidates = []
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim())
    if (cells.length < 7 || !/elite/i.test(cells[4]) || cells[6].toLowerCase() !== 'yes') continue
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(cells[0]) || cells[0].split('.').some(n => Number(n) > 255)) continue
    if (!/^\d+$/.test(cells[1]) || Number(cells[1]) < 1 || Number(cells[1]) > 65535) continue
    candidates.push(`http://${cells[0]}:${cells[1]}`)
  }
  if (!candidates.length) {
    for (const line of String(html).split(/\r?\n/)) {
      const match = line.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/)
      if (match && Number(match[2]) >= 1 && Number(match[2]) <= 65535 && !match[1].split('.').some(n => Number(n) > 255)) {
        candidates.push(`http://${match[1]}:${match[2]}`)
      }
    }
  }
  return [...new Set(candidates)]
}

export async function testVideoRoute({ id, videoUrl, pageUrl, parsed, fetchFn, timeoutMs = 10000 }) {
  const net = createIndexerNetwork({ fetchFn, timeoutMs, minIntervalMs: 700, concurrencyPerHost: 1 })
  const result = { id, transport: id === 'direct' ? 'direct' : 'proxy', checks: [], usable: false }
  let blocked = false
  async function check(stage, action) {
    const started = Date.now()
    try { result.checks.push({ stage, ok: true, ...await action(), elapsedMs: Date.now() - started }); return true }
    catch (err) {
      const code = err.code || 'NETWORK_ERROR'
      result.checks.push({ stage, ok: false, code, status: err.status || null, retryAt: err.retryAt || null, cause: err.cause?.code || null, elapsedMs: Date.now() - started })
      if (err.status === 429 || err.status === 503 || code === 'HOST_COOLDOWN') blocked = true
      return false
    }
  }
  if (pageUrl) await check('html', async () => {
    const res = await net.fetch(pageUrl, { maxBodyBytes: 2 * 1024 * 1024 })
    const text = await res.text()
    return { status: res.status, contentType: res.headers.get('content-type'), server: res.headers.get('server'), bytes: Buffer.byteLength(text), challengeSuspected: /just a moment|checking your browser|cf-chl-/i.test(text) }
  })
  if (blocked) return { ...result, stoppedForRateLimit: true }
  const rangeOk = await check('video_byte', async () => {
    const size = await probeDirectVideo(videoUrl, net.fetch)
    if (size !== parsed.length) throw Object.assign(new Error('Size mismatch'), { code: 'SIZE_MISMATCH' })
    return { status: 206, size }
  })
  if (!rangeOk) return { ...result, stoppedForRateLimit: blocked }
  const pieceOk = await check('video_piece', async () => {
    const end = Math.min(parsed.pieceLength, parsed.length) - 1
    if (end >= 8 * 1024 * 1024) throw Object.assign(new Error('Budget'), { code: 'PIECE_BUDGET' })
    const res = await net.fetch(videoUrl, { headers: { Range: `bytes=0-${end}`, 'Accept-Encoding': 'identity' }, requiredStatus: 206, maxBodyBytes: end + 1 })
    if (res.headers.get('content-range') !== `bytes 0-${end}/${parsed.length}`) throw Object.assign(new Error('Invalid Range'), { code: 'RANGE_UNAVAILABLE' })
    const bytes = new Uint8Array(await res.arrayBuffer())
    const sha1 = createHash('sha1').update(bytes).digest('hex')
    if (bytes.length !== end + 1 || sha1 !== parsed.pieces[0].toLowerCase()) throw Object.assign(new Error('Hash mismatch'), { code: 'SHA1_MISMATCH' })
    return { status: 206, index: 0, bytes: bytes.length, sha1 }
  })
  return { ...result, usable: pieceOk, stoppedForRateLimit: blocked }
}

export async function runProxyDiagnostic(options = {}) {
  const { pageUrl, proxyFile, discover = false, limit = 5, outDir = 'artifacts/proxy-diagnostic', timeoutMs = 10000, proxyOut, stateDir = '.' } = options
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('--limit debe estar entre 1 y 20')
  let video = options.videoUrl, torrent = options.torrentPath
  if (!video || !torrent) {
    const sample = findSampleVideo(stateDir)
    if (sample) {
      video = sample.videoUrl
      torrent = sample.torrentPath
      console.log(`Usando archivo de muestra: ${sample.title} (${sample.videoUrl})`)
    }
  }
  const url = directUrl(video)
  if (!url || !torrent) throw new Error('Se requieren --video y --torrent del mismo archivo (o un verified-matches.json con muestras en dist/torrents/)')
  const parsed = await parseTorrent(fs.readFileSync(torrent))
  if (parsed.files.length !== 1 || !parsed.pieces?.length) throw new Error('Torrent de un solo archivo requerido')
  fs.mkdirSync(outDir, { recursive: true })
  const report = { version: 1, startedAt: new Date().toISOString(), videoHost: new URL(url).hostname, videoUrl: url, infoHash: parsed.infoHash, routes: [], discovery: [] }
  const reportFile = resolve(outDir, 'report.json')
  const save = () => { fs.writeFileSync(reportFile + '.tmp', JSON.stringify(report, null, 2)); fs.renameSync(reportFile + '.tmp', reportFile) }
  const usableFile = resolve(outDir, 'usable-proxies.txt')
  // Never leave an earlier list looking as if this run validated it.
  fs.writeFileSync(usableFile, '')
  const direct = await testVideoRoute({ id: 'direct', videoUrl: url, pageUrl, parsed, fetchFn: fetch, timeoutMs })
  report.routes.push(direct); save(); console.log(JSON.stringify(direct))
  if (direct.stoppedForRateLimit) return report
  let input = proxyFile
  if (discover) {
    if (proxyFile) throw new Error('Elige --discover o --proxy-file')
    const net = createIndexerNetwork({ timeoutMs, maxBodyBytes: 2 * 1024 * 1024 })
    let candidates = []
    const sources = [
      'https://www.sslproxies.org/',
      'https://free-proxy-list.net/',
      'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
      'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt'
    ]
    for (const source of sources) {
      try {
        const res = await net.fetch(source)
        const found = parseProxyCandidates(await res.text())
        report.discovery.push({ source, candidates: found.length })
        for (const c of found) candidates.push(c)
        if (candidates.length >= limit * 3) break
      } catch (err) {
        report.discovery.push({ source, code: err.code, status: err.status })
        if (err.status === 429 || err.status === 503) break
      }
    }
    candidates = [...new Set(candidates)]
    input = resolve(outDir, 'candidates.txt')
    fs.writeFileSync(input, candidates.slice(0, limit).join('\n'))
    save()
    if (!candidates.length) { report.stopReason = 'no_candidates'; save(); return report }
  }
  if (!input) throw new Error('Configura --proxy-file o --discover para comparar proxies')
  const pool = new ProxyPool({ enabled: true, proxyFile: input, timeoutMs })
  try {
    await pool.warmup()
    for (const [index, proxy] of pool.workingProxies.slice(0, limit).entries()) {
      const result = await testVideoRoute({ id: `proxy-${index + 1}`, videoUrl: url, pageUrl, parsed, fetchFn: (url, opts) => pool.fetchPinned(proxy, url, opts), timeoutMs })
      report.routes.push(result)
      if (result.usable) {
        fs.appendFileSync(usableFile, proxy + '\n')
        if (proxyOut) {
          fs.mkdirSync(dirname(resolve(proxyOut)), { recursive: true })
          fs.appendFileSync(resolve(proxyOut), proxy + '\n')
        }
      }
      save(); console.log(JSON.stringify(result))
      if (result.stoppedForRateLimit) { report.stopReason = 'rate_limited'; break }
    }
  } finally { await pool.close() }
  report.finishedAt = new Date().toISOString(); save()
  return report
}

if (isMain(import.meta.url)) {
  try {
    const args = process.argv.slice(2), opts = {}
    const flags = { '--video': 'videoUrl', '--torrent': 'torrentPath', '--page': 'pageUrl', '--proxy-file': 'proxyFile', '--out': 'outDir', '--limit': 'limit', '--timeout-ms': 'timeoutMs', '--proxy-out': 'proxyOut', '--state-dir': 'stateDir' }
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--discover') opts.discover = true
      else if (flags[args[i]] && args[i + 1] && !args[i + 1].startsWith('--')) { const key = flags[args[i]]; opts[key] = ['limit', 'timeoutMs'].includes(key) ? Number(args[++i]) : args[++i] }
      else throw new Error('Opción inválida o incompleta: ' + args[i])
    }
    const result = await runProxyDiagnostic(opts)
    process.exitCode = result.routes.some(r => r.transport === 'proxy' && r.usable) ? 0 : 2
  } catch (err) { console.error(err.code || err.message); process.exitCode = 1 }
}
