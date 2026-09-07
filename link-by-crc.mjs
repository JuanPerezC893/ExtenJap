import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '5', 10)

async function findByCrc(crc) {
  if (!crc || crc.length !== 8) return null
  const url = `https://nyaa.si/?f=0&c=0_0&q=${crc}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10_000) })
    const html = await res.text()
    const m = html.match(/href="(\/download\/\d+\.torrent)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

async function main() {
  mkdirSync('dist/torrents', { recursive: true })

  // Construir lista de tareas pendientes
  const tasks = []
  for (const s of catalog) {
    for (const ep of (s.episodes ?? [])) {
      if (!ep.torrentPath && ep.crc32) {
        tasks.push({ series: s, ep })
      }
    }
  }

  console.log(`Buscando torrents por CRC32 para ${tasks.length} episodios pendientes (concurrencia ${CONCURRENCY})...`)
  let count = 0
  let processed = 0

  async function worker() {
    while (tasks.length > 0) {
      const task = tasks.shift()
      if (!task) break

      const { series, ep } = task
      const nyaaPath = await findByCrc(ep.crc32)

      if (nyaaPath) {
        try {
          const res = await fetch(`https://nyaa.si${nyaaPath}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) })
          const buf = Buffer.from(await res.arrayBuffer())
          const parsed = await parseTorrent(buf)
          parsed.urlList = [ep.url]
          parsed.announce = []
          const newBuf = toTorrentFile(parsed)
          const torrentPath = `torrents/${parsed.infoHash}.torrent`
          writeFileSync(`dist/${torrentPath}`, newBuf)

          ep.infoHash = parsed.infoHash
          ep.size = parsed.length
          ep.fileName = parsed.name
          ep.torrentPath = torrentPath
          count++
          console.log(`[${++processed}] ✔ [CRC ${ep.crc32}] ${series.title} Ep ${ep.episode}: hash ${parsed.infoHash}`)
        } catch (err) {
          console.error(`Error con ${nyaaPath}:`, err.message)
        }
      } else {
        processed++
      }

      if (count > 0 && count % 20 === 0) {
        writeFileSync('raw-catalog.json', JSON.stringify(catalog, null, 2))
      }
      await new Promise(r => setTimeout(r, 150))
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(1, tasks.length)) }, () => worker()))

  writeFileSync('raw-catalog.json', JSON.stringify(catalog, null, 2))
  console.log(`\n¡Búsqueda por CRC32 terminada! ${count} episodios vinculados.`)
}
main().catch(console.error)
