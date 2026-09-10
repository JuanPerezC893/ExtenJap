import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import parseTorrent from 'parse-torrent'
import { loadVerifiedMatches, parseIndexerArgs, probeDirectVideo, verifyPieceHashes } from './indexer.mjs'
import { createIndexerNetwork } from './lib/indexer-network.js'
import { directUrl } from './lib/direct-url.js'
import { isMain } from './lib/io.mjs'

// Test the data path with known torrent/video pairs, without tracker searches or
// changing the verified registry. Serial execution provides a low-load baseline.
export async function checkVideoPath({ stateDir = '.', limit = 3, maxMinutes = 5, pieceTimeoutMs = 60000, useProxy = false, proxyFile, fetchFn = fetch, signal: parentSignal, log = console.log } = {}) {
  const signal = AbortSignal.any([AbortSignal.timeout(maxMinutes * 60000), ...(parentSignal ? [parentSignal] : [])])
  let pool
  try {
    if (useProxy) {
      const { ProxyPool } = await import('./lib/proxy-pool.js')
      pool = new ProxyPool({ enabled: true, proxyFile, strictProxy: true, maxRetries: 0 })
      await pool.warmup(15, 100, { signal })
    }
    const network = createIndexerNetwork({ signal, concurrencyPerHost: 1, minIntervalMs: 300, fetchFn: pool ? (url, opts) => pool.fetch(url, opts, 0) : fetchFn })
    const root = resolve(stateDir, 'dist')
    const entries = Object.values(loadVerifiedMatches(stateDir).series).flatMap(s => s.episodes || []).filter(e => e.verified?.piecesVerified && e.torrentPath && directUrl(e.directUrl))
    // Start with one entry per host, then fill remaining slots.
    const hosts = new Set(), first = [], rest = []
    for (const entry of entries) {
      const host = new URL(directUrl(entry.directUrl)).hostname
      if (hosts.has(host)) rest.push(entry)
      else { hosts.add(host); first.push(entry) }
    }
    const report = { version: '0.5.7', mode: useProxy ? 'proxy' : 'direct', startedAt: new Date().toISOString(), results: [] }
    for (const entry of [...first, ...rest]) {
      if (report.results.length >= Math.min(limit, 10)) break
      signal.throwIfAborted()
      const path = resolve(root, entry.torrentPath), rel = relative(root, path)
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !existsSync(path)) continue
      const url = directUrl(entry.directUrl), start = Date.now()
      const item = { infoHash: entry.infoHash, host: new URL(url).hostname, fileName: entry.fileName, ok: false }
      try {
        const torrent = await parseTorrent(readFileSync(path))
        if (torrent.infoHash !== entry.infoHash) throw new Error('El torrent guardado no coincide con el registro')
        item.phase = 'probe'
        item.size = await probeDirectVideo(url, network.fetch, signal)
        if (item.size !== torrent.length) throw new Error('Cambió el tamaño del vídeo')
        item.phase = 'pieces'
        item.evidence = await verifyPieceHashes(url, torrent, network.fetch, { signal, evidence: true, pieceTimeoutMs })
        item.ok = Boolean(item.evidence)
        if (!item.ok) item.error = 'SHA1_MISMATCH'
      } catch (err) {
        item.error = err.code || err.message
        item.status = err.status ?? null
      }
      item.elapsedMs = Date.now() - start
      report.results.push(item)
      log(`[Control] ${item.host}: ${item.ok ? 'piezas correctas' : item.error} (${item.elapsedMs} ms)`)
    }
    report.passed = report.results.filter(r => r.ok).length
    report.ok = report.results.length > 0 && report.passed === report.results.length
    report.finishedAt = new Date().toISOString()
    mkdirSync(resolve(stateDir), { recursive: true })
    writeFileSync(resolve(stateDir, 'video-path-report.json'), JSON.stringify(report, null, 2))
    log(`[Control] ${report.passed}/${report.results.length} archivos verificados; video-path-report.json guardado`)
    return report
  } finally { await pool?.close() }
}

if (isMain(import.meta.url)) {
  try { process.exitCode = (await checkVideoPath(parseIndexerArgs(process.argv.slice(2)))).ok ? 0 : 2 }
  catch (err) { console.error(err.message); process.exitCode = 1 }
}
