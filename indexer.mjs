import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { sameRelease, episodeNumber, resolution, isBatchTorrent, VIDEO, fileName, normalize } from './lib/matching.js'
import { validateLinkedTorrent } from './lib/link-validation.js'
import { ProxyPool, defaultPool } from './lib/proxy-pool.js'
import { searchNyaa, searchAnimeTosho, buildSearchQueries } from './lib/sources.js'

export { searchNyaa, searchAnimeTosho }

const CATALOG_PATH = 'raw-catalog.json'
const VERIFIED_PATH = 'verified-matches.json'
const TORRENTS_DIR = 'dist/torrents'

mkdirSync(TORRENTS_DIR, { recursive: true })

export function loadVerifiedMatches() {
  if (existsSync(VERIFIED_PATH)) {
    try {
      const content = readFileSync(VERIFIED_PATH, 'utf8')
      if (!content.trim()) throw new Error('Archivo vacío')
      return JSON.parse(content)
    } catch (err) {
      const corruptPath = `${VERIFIED_PATH}.corrupt.${Date.now()}`
      copyFileSync(VERIFIED_PATH, corruptPath)
      throw new Error(`Error crítico al leer ${VERIFIED_PATH}. Se respaldó copia en ${corruptPath}. Detalle: ${err.message}`)
    }
  }
  return { updatedAt: new Date().toISOString(), series: {} }
}

export function saveVerifiedMatches(data) {
  data.updatedAt = new Date().toISOString()
  const tmpPath = `${VERIFIED_PATH}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmpPath, VERIFIED_PATH)
}

export async function verifyPieceHashes(directUrl, parsed, fetchFn = fetch) {
  if (!parsed.pieces?.length || !parsed.pieceLength) return false
  const indices = new Set([0, parsed.pieces.length - 1])
  for (const i of indices) {
    const start = i * parsed.pieceLength
    const end = Math.min(start + parsed.pieceLength, parsed.length) - 1
    let res = null
    try {
      res = await fetch(directUrl, {
        headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
        signal: AbortSignal.timeout(15000)
      })
    } catch {
      if (fetchFn !== fetch) {
        try {
          res = await fetchFn(directUrl, {
            headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
            signal: AbortSignal.timeout(15000)
          })
        } catch {
          return false
        }
      } else {
        return false
      }
    }
    if (!res || res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${parsed.length}`) {
      await res?.body?.cancel?.()
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

export async function findAndPrepareTorrent(series, ep, options = {}) {
  const { verifyPieces = false, signal = AbortSignal.timeout(30000), fetchFn = fetch } = options
  const epNum = Number(ep.episode)
  const fn = ep.fileName || fileName(ep)
  const expectedRes = resolution(fn) || String(ep.resolution || '')

  const queries = buildSearchQueries(series, ep)
  const seenCandidates = new Set()

  for (const { query: q, provider } of queries) {
    if (signal.aborted) break

    const items = []

    // 1. Consultar Nyaa.si
    if (provider === 'nyaa' || provider === 'all') {
      const nyaaItems = await searchNyaa(q, fetchFn)
      items.push(...nyaaItems)
    }

    // 2. Consultar AnimeTosho
    if (provider === 'animetosho' || provider === 'all') {
      const toshoItems = await searchAnimeTosho(q, fetchFn)
      items.push(...toshoItems)
    }

    for (const item of items) {
      if (!item.torrent_url || seenCandidates.has(item.torrent_url)) continue
      seenCandidates.add(item.torrent_url)

      if (item.num_files && isBatchTorrent(item)) continue

      const title = item.title || ''
      const itemEp = episodeNumber(title)
      if (itemEp !== null && itemEp !== epNum) continue

      const itemRes = resolution(title)
      if (itemRes && expectedRes && itemRes !== expectedRes) continue

      // Descargar y validar candidate .torrent contra el archivo real interno
      try {
        const tRes = await fetchFn(item.torrent_url, { signal: AbortSignal.timeout(15000) })
        if (!tRes.ok) continue
        const tBuf = new Uint8Array(await tRes.arrayBuffer())
        const parsed = await parseTorrent(tBuf)

        // Validar el archivo real contenido dentro del torrent
        validateLinkedTorrent(parsed, ep)

        let piecesOk = false
        if (verifyPieces && ep.url) {
          piecesOk = await verifyPieceHashes(ep.url, parsed, fetchFn)
          if (!piecesOk) {
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
          matchedBy: item.source || 'multi-source',
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

export function episodeReleaseMatch(entry, ep) {
  if (entry.episode !== ep.episode) return false
  if (String(entry.resolution) !== String(ep.resolution)) return false
  const epFn = fileName(ep)
  if (entry.fileName && epFn && entry.fileName === epFn) return true
  if (entry.directUrl && ep.url && entry.directUrl === ep.url) return true
  if (entry.quality && ep.quality && entry.quality === ep.quality) return true
  return false
}

export async function runIndexer(options = {}) {
  const {
    seriesFilter = [],
    verifyPieces = true,
    limit = Infinity,
    concurrency = 1,
    useProxy = false,
    proxyFile = null,
    batchRange = null,
    includeNonAnime = false
  } = options

  const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'))
  const verifiedMatches = loadVerifiedMatches()

  // Inicializar Proxy Pool si se solicita
  const pool = new ProxyPool({ enabled: useProxy, proxyFile })
  if (useProxy) {
    console.log('[Indexer] Inicializando pool de proxies rotativo...')
    await pool.warmup(15)
  }
  const fetchFn = useProxy ? (url, opt) => pool.fetch(url, opt) : fetch

  // 1. Filtrar por anime válido (con AniList ID) por defecto para evitar series occidentales
  let targetSeries = catalog
  if (!includeNonAnime) {
    const totalBefore = targetSeries.length
    targetSeries = targetSeries.filter(s => s.anilistId)
    const skipped = totalBefore - targetSeries.length
    if (skipped > 0) {
      console.log(`Filtro de anime: Se omitieron ${skipped} series no-anime sin AniList ID (ej. películas/series occidentales).`)
    }
  }

  // 2. Rango batch por índice si se especifica
  if (batchRange && Array.isArray(batchRange) && batchRange.length === 2) {
    const [start, end] = batchRange
    targetSeries = targetSeries.slice(start, end)
    console.log(`Filtro por rango batch: índices [${start}..${end}] (${targetSeries.length} series)`)
  }

  // 3. Filtro por series específicas si se especifica
  if (seriesFilter.length > 0) {
    const filterLower = seriesFilter.map(s => String(s).toLowerCase().trim())
    targetSeries = targetSeries.filter(s => {
      const idMatch = s.anilistId && filterLower.includes(String(s.anilistId))
      const titleMatch = filterLower.some(f => !/^\d+$/.test(f) && ((s.title || '').toLowerCase().includes(f) || (s.aliases || []).some(a => a.toLowerCase().includes(f))))
      return idMatch || titleMatch
    })
  }

  console.log(`=== Indexador Independiente Multi-Fuente (Nyaa + AnimeTosho) ===`)
  console.log(`Series seleccionadas: ${targetSeries.length}`)
  console.log(`Concurrencia: ${concurrency} trabajador(es) simultáneo(s)`)
  console.log(`Rotación de proxies: ${useProxy ? 'ACTIVADA' : 'DESACTIVADA'}`)
  console.log(`Verificación de piezas obligatoria: ${verifyPieces ? 'SI (SHA-1 HTTP Range)' : 'NO'}`)

  // Cola serializada para guardados atómicos seguros en disco
  let saveChain = Promise.resolve()
  function scheduleSave() {
    saveChain = saveChain.then(() => {
      saveVerifiedMatches(verifiedMatches)
    }).catch(err => console.error('[Indexer] Error al guardar verifiedMatches:', err.message))
    return saveChain
  }

  let totalLinked = 0
  let totalProcessed = 0

  // Construir lista plana de tareas de episodios
  const tasks = []
  for (const s of targetSeries) {
    const sId = String(s.anilistId || s.id || s.title)
    if (!verifiedMatches.series[sId]) {
      verifiedMatches.series[sId] = {
        title: s.title,
        anilistId: s.anilistId ?? null,
        episodes: []
      }
    }
    const seriesRecord = verifiedMatches.series[sId]
    for (const ep of (s.episodes ?? [])) {
      tasks.push({ series: s, seriesRecord, ep })
    }
  }

  console.log(`Total de episodios/versiones en cola: ${tasks.length}\n`)

  const effectiveConcurrency = Math.max(1, Math.min(concurrency, tasks.length || 1))
  let taskIndex = 0

  async function worker(workerId) {
    while (taskIndex < tasks.length && totalProcessed < limit) {
      const currentIdx = taskIndex++
      const { series: s, seriesRecord, ep } = tasks[currentIdx]
      totalProcessed++

      const existing = seriesRecord.episodes.find(e => episodeReleaseMatch(e, ep))
      const urlUnchanged = existing?.directUrl === ep.url
      const torrentExists = existing?.torrentPath && existsSync(`dist/${existing.torrentPath}`)
      const piecesSatisfied = !verifyPieces || existing?.verified?.piecesVerified === true

      if (existing && urlUnchanged && torrentExists && piecesSatisfied) {
        console.log(`[W${workerId}] ✔ ${s.title} Ep ${ep.episode} (${ep.resolution}p): Ya verificado previamente (${existing.infoHash})`)
        continue
      }

      console.log(`[W${workerId}] 🔍 Buscando y verificando: ${s.title} Ep ${ep.episode} (${ep.resolution}p)...`)
      const match = await findAndPrepareTorrent(s, ep, { verifyPieces, fetchFn })
      if (match) {
        console.log(`[W${workerId}] ✔ ¡Torrent verificado con WebSeed embebido! [${s.title} Ep ${ep.episode} ${ep.resolution}p -> ${match.matchedBy} -> Hash: ${match.infoHash}]`)
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

        const idx = seriesRecord.episodes.findIndex(e => episodeReleaseMatch(e, ep))
        if (idx >= 0) seriesRecord.episodes[idx] = epData
        else seriesRecord.episodes.push(epData)

        ep.torrentPath = match.torrentPath
        ep.infoHash = match.infoHash
        ep.size = match.size

        totalLinked++
        await scheduleSave()
      } else {
        console.log(`[W${workerId}] ✖ ${s.title} Ep ${ep.episode} (${ep.resolution}p): Sin torrent idéntico en trackers (queda pendiente).`)
      }

      if (!useProxy) {
        await new Promise(r => setTimeout(r, 150))
      }
    }
  }

  // Ejecutar trabajadores paralelos
  const workers = Array.from({ length: effectiveConcurrency }, (_, i) => worker(i + 1))
  await Promise.all(workers)

  // Guardar catálogo actualizado y asegurar último guardado
  writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf8')
  await scheduleSave()

  console.log(`\n=== Indexación completada ===`)
  console.log(`Episodios vinculados y preparados: ${totalLinked}`)
}

// Ejecución directa por CLI si se llama standalone
if (process.argv[1]?.endsWith('indexer.mjs')) {
  const args = process.argv.slice(2)
  const series = []
  let concurrency = 1
  let useProxy = false
  let proxyFile = null
  let batchRange = null
  let noPieces = false
  let includeNonAnime = false

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--concurrency' && i + 1 < args.length) {
      concurrency = parseInt(args[++i], 10) || 1
    } else if (arg === '--proxy-file' && i + 1 < args.length) {
      proxyFile = args[++i]
    } else if (arg === '--batch' && i + 2 < args.length) {
      batchRange = [parseInt(args[++i], 10), parseInt(args[++i], 10)]
    } else if (arg === '--no-pieces') {
      noPieces = true
    } else if (arg === '--proxy') {
      useProxy = true
    } else if (arg === '--include-non-anime') {
      includeNonAnime = true
    } else if (arg === '--series') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        series.push(args[++i])
      }
    }
  }

  runIndexer({
    seriesFilter: series,
    verifyPieces: !noPieces,
    concurrency,
    useProxy,
    proxyFile,
    batchRange,
    includeNonAnime
  }).catch(console.error)
}
