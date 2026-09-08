import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { sameRelease, episodeNumber, resolution, isBatchTorrent, VIDEO, fileName, normalize } from './lib/matching.js'
import { validateLinkedTorrent } from './lib/link-validation.js'

const CATALOG_PATH = 'raw-catalog.json'
const VERIFIED_PATH = 'verified-matches.json'
const TORRENTS_DIR = 'dist/torrents'

mkdirSync(TORRENTS_DIR, { recursive: true })

export function loadVerifiedMatches() {
  if (existsSync(VERIFIED_PATH)) {
    try {
      return JSON.parse(readFileSync(VERIFIED_PATH, 'utf8'))
    } catch {
      return { updatedAt: new Date().toISOString(), series: {} }
    }
  }
  return { updatedAt: new Date().toISOString(), series: {} }
}

export function saveVerifiedMatches(data) {
  data.updatedAt = new Date().toISOString()
  writeFileSync(VERIFIED_PATH, JSON.stringify(data, null, 2), 'utf8')
}

export async function verifyPieceHashes(directUrl, parsed) {
  if (!parsed.pieces?.length || !parsed.pieceLength) return false
  const indices = new Set([0, parsed.pieces.length - 1])
  for (const i of indices) {
    const start = i * parsed.pieceLength
    const end = Math.min(start + parsed.pieceLength, parsed.length) - 1
    const res = await fetch(directUrl, {
      headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
      signal: AbortSignal.timeout(20000)
    })
    if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${parsed.length}`) {
      await res.body?.cancel()
      return false
    }
    const piece = new Uint8Array(await res.arrayBuffer())
    const hash = createHash('sha1').update(piece).digest('hex')
    if (hash.toLowerCase() !== parsed.pieces[i].toLowerCase()) {
      return false
    }
  }
  return true
}

export async function searchAnimeTosho(queryStr) {
  const url = `https://feed.animetosho.org/json?q=${encodeURIComponent(queryStr)}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

export async function findAndPrepareTorrent(series, ep, options = {}) {
  const { verifyPieces = false, signal = AbortSignal.timeout(30000) } = options
  const epNum = Number(ep.episode)
  const fn = fileName(ep)
  const crc = ep.crc32 || fn.match(/\[([a-f\d]{8})\]/i)?.[1]
  const cleanTitle = (series.title || '').replace(/[!?:;,."']/g, ' ').replace(/\s+/g, ' ').trim()

  const queries = new Set()
  if (crc) queries.add(crc)
  if (fn) queries.add(fn.replace(/\.[a-z0-9]+$/i, ''))
  const epStr = String(epNum).padStart(2, '0')
  const resStr = ep.resolution ? `${ep.resolution}p` : ''
  if (resStr) queries.add(`${cleanTitle} ${epStr} ${resStr}`)
  queries.add(`${cleanTitle} ${epStr}`)
  if (epNum === 1) {
    if (resStr) queries.add(`${cleanTitle} ${resStr}`)
    queries.add(cleanTitle)
  }

  for (const q of queries) {
    if (signal.aborted) break
    const items = await searchAnimeTosho(q)
    for (const item of items) {
      if (!item.torrent_url || !item.info_hash || isBatchTorrent(item)) continue
      const title = item.title || item.torrent_name || ''
      const itemEp = episodeNumber(title)
      if (itemEp !== null && itemEp !== epNum) continue

      const itemRes = resolution(title)
      const expectedRes = resolution(fn) || String(ep.resolution || '')
      if (itemRes && expectedRes && itemRes !== expectedRes) continue

      // Descargar y validar candidate .torrent contra el archivo real interno
      try {
        const tRes = await fetch(item.torrent_url, { signal: AbortSignal.timeout(15000) })
        if (!tRes.ok) continue
        const tBuf = new Uint8Array(await tRes.arrayBuffer())
        const parsed = await parseTorrent(tBuf)

        // Validar el archivo real contenido dentro del torrent
        validateLinkedTorrent(parsed, ep)

        let piecesOk = false
        if (verifyPieces && ep.url) {
          piecesOk = await verifyPieceHashes(ep.url, parsed)
          if (!piecesOk) {
            console.warn(`    ⚠ Piezas no coinciden para ${title}, descartando candidato.`)
            continue
          }
        }

        // Inyectar WebSeed (BEP-19 url-list)
        parsed.urlList = [ep.url]
        const modifiedBuf = toTorrentFile(parsed)
        const torrentPath = `torrents/${parsed.infoHash}.torrent`
        writeFileSync(`dist/${torrentPath}`, modifiedBuf)

        return {
          infoHash: parsed.infoHash,
          size: parsed.length,
          torrentFileName: parsed.files[0].name,
          torrentPath,
          piecesVerified: piecesOk,
          matchedBy: crc && (title.includes(crc) || parsed.files[0].name.includes(crc)) ? 'crc' : 'same-release',
          title: parsed.name
        }
      } catch (err) {
        // candidato no válido
        continue
      }
    }
  }

  return null
}

export async function runIndexer(options = {}) {
  const { seriesFilter = [], verifyPieces = false, limit = Infinity } = options
  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  const verifiedMatches = loadVerifiedMatches()

  let targetSeries = catalog
  if (seriesFilter.length > 0) {
    const filterLower = seriesFilter.map(s => String(s).toLowerCase().trim())
    targetSeries = catalog.filter(s => {
      const idMatch = s.anilistId && filterLower.includes(String(s.anilistId))
      const titleMatch = filterLower.some(f => (s.title || '').toLowerCase().includes(f) || (s.aliases || []).some(a => a.toLowerCase().includes(f)))
      return idMatch || titleMatch
    })
  }

  console.log(`=== Indexador Independiente de Torrents y WebSeeds ===`)
  console.log(`Series seleccionadas: ${targetSeries.length}`)
  console.log(`Verificación de piezas: ${verifyPieces ? 'ACTIVADA' : 'DESACTIVADA'}`)

  let totalLinked = 0
  let totalProcessed = 0

  for (const s of targetSeries) {
    if (totalProcessed >= limit) break
    const sId = String(s.anilistId || s.id || s.title)
    if (!verifiedMatches.series[sId]) {
      verifiedMatches.series[sId] = {
        title: s.title,
        anilistId: s.anilistId ?? null,
        episodes: []
      }
    }

    const seriesRecord = verifiedMatches.series[sId]
    console.log(`\nProcesando "${s.title}" (AniList: ${s.anilistId ?? 'N/A'}, ${s.episodes?.length ?? 0} episodios)...`)

    for (const ep of (s.episodes ?? [])) {
      totalProcessed++
      const existing = seriesRecord.episodes.find(e => e.episode === ep.episode && String(e.resolution) === String(ep.resolution))
      if (existing && existsSync(`dist/${existing.torrentPath}`)) {
        console.log(`  ✔ Ep ${ep.episode} (${ep.resolution}p): Ya verificado previamente (${existing.infoHash})`)
        continue
      }

      console.log(`  🔍 Buscando torrent para Ep ${ep.episode} (${ep.resolution}p)...`)
      const match = await findAndPrepareTorrent(s, ep, { verifyPieces })
      if (match) {
        console.log(`  ✔ Ep ${ep.episode} (${ep.resolution}p): ¡Torrent encontrado y WebSeed embebido! [Hash: ${match.infoHash}]`)
        const epData = {
          episode: ep.episode,
          resolution: String(ep.resolution || ''),
          quality: ep.quality || `${ep.resolution}p`,
          fileName: match.torrentFileName,
          size: match.size,
          directUrl: ep.url,
          infoHash: match.infoHash,
          torrentPath: match.torrentPath,
          verified: {
            matchedBy: match.matchedBy,
            piecesVerified: match.piecesVerified,
            verifiedAt: new Date().toISOString()
          },
          isOnline: true
        }

        // Actualizar verifiedMatches
        const idx = seriesRecord.episodes.findIndex(e => e.episode === ep.episode && String(e.resolution) === String(ep.resolution))
        if (idx >= 0) seriesRecord.episodes[idx] = epData
        else seriesRecord.episodes.push(epData)

        // Actualizar en el objeto del catálogo en memoria
        ep.torrentPath = match.torrentPath
        ep.infoHash = match.infoHash
        ep.size = match.size

        totalLinked++
        saveVerifiedMatches(verifiedMatches)
      } else {
        console.log(`  ✖ Ep ${ep.episode} (${ep.resolution}p): Sin torrent idéntico en trackers (queda pendiente).`)
      }

      await new Promise(r => setTimeout(r, 200))
    }
  }

  // Guardar catálogo actualizado
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8')
  saveVerifiedMatches(verifiedMatches)

  console.log(`\n=== Indexación completada ===`)
  console.log(`Episodios vinculados y preparados: ${totalLinked}`)
}

// Ejecución directa por CLI si se llama standalone
if (process.argv[1]?.endsWith('indexer.mjs')) {
  const args = process.argv.slice(2)
  const pieces = args.includes('--pieces')
  const seriesIdx = args.indexOf('--series')
  let series = []
  if (seriesIdx >= 0) {
    series = args.slice(seriesIdx + 1).filter(a => !a.startsWith('--'))
  }
  runIndexer({ seriesFilter: series, verifyPieces: pieces }).catch(console.error)
}
