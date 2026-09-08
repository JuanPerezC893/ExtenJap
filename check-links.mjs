import { parseArgs } from 'node:util'
import { readJson, writeJson } from './lib/io.mjs'
const { values } = parseArgs({ options: {
  series: { type: 'string' }, episode: { type: 'string' }, resolution: { type: 'string' },
  limit: { type: 'string', default: '1' }
} })
const limit = Number(values.limit)
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('--limit debe ser un entero positivo')
const catalog = readJson('raw-catalog.json')
let count = 0
for (const series of catalog) {
  if (values.series && String(series.sourceV) !== values.series) continue
  for (const ep of series.episodes) {
    if (count >= limit) break
    if (values.episode && Number(ep.episode) !== Number(values.episode)) continue
    if (values.resolution && String(ep.resolution) !== values.resolution) continue
    count++
    ep.isOnline = null
    ep.checkedAt = new Date().toISOString()
    try {
      const response = await fetch(ep.url, { headers: { Range: 'bytes=0-0', 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(15_000) })
      ep.lastCheckStatus = response.status
      const range = response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/)
      if (response.status === 206 && range) {
        const validSize = !ep.size || Number(ep.size) === Number(range[1])
        ep.isOnline = validSize && (await response.arrayBuffer()).byteLength === 1
      } else {
        await response.body?.cancel()
        if ([404, 410].includes(response.status)) ep.isOnline = false
      }
    } catch { ep.lastCheckStatus = 'network-error' }
    console.log(`${series.title} ${ep.episode} ${ep.resolution}p: ${ep.isOnline === null ? 'desconocido' : ep.isOnline ? 'Range verificado' : 'no disponible'}`)
    writeJson('raw-catalog.json', catalog)
  }
}
console.log(`${count} enlaces comprobados. Ejecuta npm run build para actualizar dist.`)
