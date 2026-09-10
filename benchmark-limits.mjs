import fs from 'node:fs'
import { resolve } from 'node:path'
import { runIndexer } from './indexer.mjs'
import { isMain } from './lib/io.mjs'

export const DEFAULT_LEVELS = [
  { level: 1, name: 'Conservador', concurrency: 2, intervalMs: 400 },
  { level: 2, name: 'Moderado', concurrency: 4, intervalMs: 250 },
  { level: 3, name: 'Rápido', concurrency: 6, intervalMs: 150 },
  { level: 4, name: 'Muy Rápido', concurrency: 8, intervalMs: 80 },
  { level: 5, name: 'Extremo', concurrency: 12, intervalMs: 30 },
  { level: 6, name: 'Límite Máximo', concurrency: 16, intervalMs: 0 }
]

export function formatTable(levels) {
  const headers = ['Nivel', 'Perfil', 'Workers', 'Intervalo', 'Preparados', 'Tiempo (s)', 'Velocidad (arch/min)', 'Estado']
  const rows = levels.map(l => [
    String(l.level),
    l.name,
    String(l.concurrency),
    `${l.intervalMs} ms`,
    String(l.prepared),
    `${l.elapsedSeconds}s`,
    `${l.filesPerMinute}/min`,
    l.blockedHosts?.length ? 'RATE_LIMITED' : l.stopReason === 'limit' || l.stopReason === 'complete' ? 'OK' : (l.stopReason || 'OK')
  ])

  const colWidths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => r[i]?.length || 0)))
  const pad = (str, len) => str + ' '.repeat(Math.max(0, len - str.length))

  const headerLine = headers.map((h, i) => pad(h, colWidths[i])).join(' | ')
  const sepLine = colWidths.map(w => '-'.repeat(w)).join('-+-')
  const rowLines = rows.map(r => r.map((c, i) => pad(c, colWidths[i])).join(' | '))

  return [headerLine, sepLine, ...rowLines].join('\n')
}

export function parseBenchmarkArgs(args) {
  const opts = { seriesFilter: [] }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--catalog' && args[i + 1]) opts.catalogPath = args[++i]
    else if (a === '--state-dir' && args[i + 1]) opts.stateDir = args[++i]
    else if (a === '--proxy') opts.useProxy = true
    else if (a === '--proxy-file' && args[i + 1]) opts.proxyFile = args[++i]
    else if (a === '--batch-size' && args[i + 1]) {
      const b = Number(args[++i])
      if (!Number.isInteger(b) || b <= 0) throw new Error('Valor inválido para --batch-size')
      opts.batchSize = b
    }
    else if (a === '--out' && args[i + 1]) opts.outDir = args[++i]
    else if (a === '--series') {
      opts.seriesFilter.push(args[++i])
      while (args[i + 1] && !args[i + 1].startsWith('--')) opts.seriesFilter.push(args[++i])
    }
    else throw new Error('Opción desconocida o incompleta: ' + a)
  }
  return opts
}

export async function runBenchmark(options = {}, indexerRunner = runIndexer) {
  const {
    catalogPath = fs.existsSync('raw-catalog.json') ? 'raw-catalog.json' : 'dist/indexed-catalog.json',
    stateDir = '.',
    useProxy = false,
    proxyFile = null,
    batchSize = 25,
    levels = DEFAULT_LEVELS,
    outDir = 'artifacts/benchmark',
    log = console.log,
    signal,
    cooldownBetweenLevelsMs = 1500,
    seriesFilter = []
  } = options

  fs.mkdirSync(outDir, { recursive: true })
  const report = {
    version: 1,
    startedAt: new Date().toISOString(),
    batchSize,
    levels: [],
    optimalLevel: null,
    stopReason: null
  }

  log('================================================================================')
  log('           TEST DE ESTRÉS / BENCHMARK DE RENDIMIENTO (JapanPaw)                ')
  log('================================================================================')
  log(`Catálogo: ${catalogPath}`)
  log(`Estado: ${stateDir}`)
  log(`Modo: ${useProxy ? 'Con Proxy/WARP (' + proxyFile + ')' : 'Conexión Directa'}`)
  log(`Archivos por nivel: ${batchSize}`)
  log('--------------------------------------------------------------------------------\n')

  let bestLevel = null
  let maxThroughput = 0

  for (let idx = 0; idx < levels.length; idx++) {
    const lvl = levels[idx]
    if (signal?.aborted) {
      report.stopReason = 'interrupted'
      break
    }

    log(`>>> INICIANDO NIVEL ${lvl.level}: ${lvl.name.toUpperCase()}`)
    log(`    Concurrencia: ${lvl.concurrency} workers | Intervalo: ${lvl.intervalMs} ms | Tanda: ${batchSize} archivos`)

    const startedAt = Date.now()
    let result
    try {
      result = await indexerRunner({
        catalogPath,
        stateDir,
        concurrency: lvl.concurrency,
        intervalMs: lvl.intervalMs,
        limit: batchSize,
        maxMinutes: 10,
        useProxy,
        proxyFile,
        retryPending: false,
        signal,
        seriesFilter,
        log: (msg) => {
          if (msg.startsWith('[W') || msg.startsWith('Tanda')) {
            log('    ' + msg)
          }
        }
      })
    } catch (err) {
      log(`    [!] Error en nivel ${lvl.level}: ${err.message}`)
      result = { error: err.message, stopReason: 'error' }
    }

    const elapsedSeconds = Math.max(0.001, (Date.now() - startedAt) / 1000)
    const attempted = result?.attempted || 0
    const prepared = result?.prepared || 0
    const reused = result?.reused || 0
    const deferred = result?.deferred || 0
    const incompatible = result?.incompatible || 0

    const providers = result?.providers?.hosts || {}
    const blockedHosts = Object.entries(providers).filter(([h, s]) =>
      s.lastStatus === 429 || s.lastFailureCode === 'RATE_LIMITED' || Number(s.retryAt) > Date.now()
    )

    const filesPerMinute = Number(((prepared / elapsedSeconds) * 60).toFixed(1))

    const lvlRecord = {
      level: lvl.level,
      name: lvl.name,
      concurrency: lvl.concurrency,
      intervalMs: lvl.intervalMs,
      elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
      attempted,
      prepared,
      reused,
      deferred,
      incompatible,
      filesPerMinute,
      blockedHosts: blockedHosts.map(([h, s]) => ({ host: h, status: s.lastStatus, retryAt: s.retryAt })),
      stopReason: result?.stopReason || null
    }

    report.levels.push(lvlRecord)
    const reportFile = resolve(outDir, 'report.json')
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8')

    log(`\n    [RESUMEN NIVEL ${lvl.level}]: ${prepared} preparados en ${elapsedSeconds.toFixed(1)}s -> ${filesPerMinute} archivos/minuto.`)

    if (blockedHosts.length > 0 || result?.stopReason === 'providers_unavailable') {
      log(`\n    [ALERTA DE SATURACIÓN]: Se detectó límite de tasa (429/Cooldown) en: ${blockedHosts.map(b => b.host).join(', ') || result?.stopReason}`)
      log(`    -> Se alcanzó el techo seguro. Deteniendo pruebas para proteger tus cuotas.`)
      report.stopReason = 'rate_limited'
      break
    }

    if (result?.stopReason === 'video_host_unavailable') {
      log(`\n    [PAUSA DE VIDEO]: El servidor de almacenamiento de video pausó temporalmente por archivos inaccesibles.`)
      log(`    -> Deteniendo pruebas en este punto. Los avances fueron guardados.`)
      report.stopReason = 'video_host_unavailable'
      break
    }

    if (filesPerMinute > maxThroughput && prepared > 0) {
      maxThroughput = filesPerMinute
      bestLevel = lvlRecord
    }

    if (result?.stopReason === 'complete' || (result?.remaining !== undefined && result?.remaining === 0)) {
      log('\n    [FIN DE CATÁLOGO]: No quedan más archivos pendientes por indexar.')
      report.stopReason = 'catalog_exhausted'
      break
    }

    log('--------------------------------------------------------------------------------\n')

    if (idx < levels.length - 1 && cooldownBetweenLevelsMs > 0) {
      await new Promise(r => setTimeout(r, cooldownBetweenLevelsMs))
    }
  }

  report.finishedAt = new Date().toISOString()
  report.optimalLevel = bestLevel
  if (!report.stopReason) report.stopReason = 'completed'

  const finalReportFile = resolve(outDir, 'report.json')
  fs.writeFileSync(finalReportFile, JSON.stringify(report, null, 2), 'utf8')

  log('\n================================================================================')
  log('                             TABLA COMPARATIVA FINAL                            ')
  log('================================================================================')
  log(formatTable(report.levels))
  log('================================================================================')

  if (bestLevel) {
    log(`>>> PUNTO ÓPTIMO RECOMENDADO: Nivel ${bestLevel.level} (${bestLevel.name})`)
    log(`    - Trabajadores: ${bestLevel.concurrency}`)
    log(`    - Intervalo: ${bestLevel.intervalMs} ms`)
    log(`    - Rendimiento medido: ${bestLevel.filesPerMinute} archivos/minuto (~${Math.round(bestLevel.filesPerMinute * 60)} archivos/hora)`)
    const estimatedHours = Number((70000 / (bestLevel.filesPerMinute * 60)).toFixed(1))
    log(`    - Tiempo estimado para todo el catálogo (~70k archivos): ~${estimatedHours} horas.`)
  } else {
    log('>>> No se pudo determinar un punto óptimo limpio en esta sesión.')
  }
  log('================================================================================\n')

  return report
}

const isDirectRun = isMain(import.meta.url) || Boolean(process.argv[1] && process.argv[1].endsWith('benchmark-limits.mjs'))
if (isDirectRun) {
  const controller = new AbortController()
  const stop = () => { console.warn('Interrupción solicitada...'); controller.abort() }
  process.once('SIGINT', stop); process.once('SIGTERM', stop)

  try {
    const opts = parseBenchmarkArgs(process.argv.slice(2))
    await runBenchmark({ ...opts, signal: controller.signal })
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop)
  }
}
