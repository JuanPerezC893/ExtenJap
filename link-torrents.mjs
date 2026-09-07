import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))

async function findNyaaTorrent(title, ep, res, crc) {
  // Búsqueda precisa por título, número de episodio y CRC32 o resolución
  const cleanTitle = title.replace(/[!?:;,."']/g, ' ').replace(/\s+/g, ' ').trim()
  const epStr = String(ep).padStart(2, '0')
  const query = encodeURIComponent(`${cleanTitle} ${epStr} Erai-raws ${res}p`)
  const url = `https://nyaa.si/?f=0&c=0_0&q=${query}`

  try {
    const resFetch = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const html = await resFetch.text()
    const rows = html.split('</tr>')

    // Prioridad 1: Match por CRC32
    if (crc) {
      for (const r of rows) {
        if (r.toUpperCase().includes(crc.toUpperCase())) {
          const m = r.match(/href="(\/download\/\d+\.torrent)"/)
          if (m) return m[1]
        }
      }
    }

    // Prioridad 2: Match por título + episodio + resolución
    for (const r of rows) {
      if (r.includes(epStr) && (r.includes(`${res}p`) || r.includes(`${res}`))) {
        const m = r.match(/href="(\/download\/\d+\.torrent)"/)
        if (m) return m[1]
      }
    }
  } catch (err) {
    console.error(`Error buscando "${cleanTitle}" Ep ${ep}:`, err.message)
  }
  return null
}

async function linkSeries(series) {
  let linked = 0
  mkdirSync('dist/torrents', { recursive: true })

  for (const ep of (series.episodes ?? [])) {
    if (ep.torrentPath && ep.infoHash) continue

    const nyaaPath = await findNyaaTorrent(series.title, ep.episode, ep.resolution, ep.crc32)
    if (nyaaPath) {
      const torrentUrl = `https://nyaa.si${nyaaPath}`
      try {
        const res = await fetch(torrentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
        linked++
        console.log(`  ✔ Ep ${ep.episode} (${ep.resolution}p): hash ${parsed.infoHash}`)
      } catch (err) {
        console.error(`Error procesando ${torrentUrl}:`, err.message)
      }
      await new Promise(r => setTimeout(r, 250))
    } else {
      console.log(`  ✖ No encontrado en Nyaa: ${series.title} Ep ${ep.episode} (${ep.resolution}p)`)
    }
  }

  return linked
}

async function main() {
  console.log('Vinculando torrents para series pendientes...')
  let total = 0

  for (const s of catalog) {
    const unlinked = (s.episodes ?? []).filter(e => !e.torrentPath)
    if (unlinked.length > 0) {
      console.log(`\nProcesando "${s.title}" (${unlinked.length} episodios pendientes)...`)
      const count = await linkSeries(s)
      total += count
      writeFileSync('raw-catalog.json', JSON.stringify(catalog, null, 2))
    }
  }

  console.log(`\n¡Listo! ${total} episodios vinculados con torrent oficial + WebSeed.`)
}
main().catch(console.error)
