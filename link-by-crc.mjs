import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))

async function findByCrc(crc) {
  if (!crc || crc.length !== 8) return null
  const url = `https://nyaa.si/?f=0&c=0_0&q=${crc}`
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const html = await res.text()
    const m = html.match(/href="(\/download\/\d+\.torrent)"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

async function main() {
  console.log('Buscando torrents por CRC32 exacto para los pendientes...')
  mkdirSync('dist/torrents', { recursive: true })
  let count = 0

  for (const s of catalog) {
    for (const ep of (s.episodes ?? [])) {
      if (ep.torrentPath && ep.infoHash) continue
      if (!ep.crc32) continue

      const nyaaPath = await findByCrc(ep.crc32)
      if (nyaaPath) {
        try {
          const res = await fetch(`https://nyaa.si${nyaaPath}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })
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
          console.log(`✔ [CRC ${ep.crc32}] ${s.title} Ep ${ep.episode}: hash ${parsed.infoHash}`)
        } catch (err) {
          console.error(`Error con ${nyaaPath}:`, err.message)
        }
        await new Promise(r => setTimeout(r, 200))
      }
    }
  }

  writeFileSync('raw-catalog.json', JSON.stringify(catalog, null, 2))
  console.log(`\n¡Búsqueda por CRC32 terminada! ${count} episodios adicionales vinculados.`)
}
main().catch(console.error)
