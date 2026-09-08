import parseTorrent, { toTorrentFile } from 'parse-torrent'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { validateLinkedTorrent } from './lib/link-validation.js'

const catalog = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))
const lara = catalog.find(s => s.title === 'Sayonara Lara')

async function findNyaaTorrent(title, ep, res, crc) {
  const query = encodeURIComponent(`Sayonara Lara ${String(ep).padStart(2, '0')} Erai-raws ${res}p`)
  const url = `https://nyaa.si/?f=0&c=0_0&q=${query}`
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    const html = await response.text()
    const rows = html.split('</tr>')
    for (const r of rows) {
      if (crc && r.toUpperCase().includes(crc.toUpperCase())) {
        const m = r.match(/href="(\/download\/\d+\.torrent)"/)
        if (m) return m[1]
      }
    }
    // Fallback if CRC not in row title directly
    for (const r of rows) {
      if (r.includes('Erai-raws') && (r.includes(`${res}p`) || r.includes(`${res}`)) && r.includes(String(ep).padStart(2, '0'))) {
        const m = r.match(/href="(\/download\/\d+\.torrent)"/)
        if (m) return m[1]
      }
    }
  } catch (err) {
    console.error(`Error buscando Ep ${ep} ${res}p:`, err.message)
  }
  return null
}

async function main() {
  console.log('Buscando torrents en Nyaa para los 20 episodios de Sayonara Lara...')
  mkdirSync('dist/torrents', { recursive: true })
  let count = 0

  for (const ep of lara.episodes) {
    const nyaaPath = await findNyaaTorrent('Sayonara Lara', ep.episode, ep.resolution, ep.crc32)
    if (nyaaPath) {
      const torrentUrl = `https://nyaa.si${nyaaPath}`
      try {
        const res = await fetch(torrentUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        const buf = Buffer.from(await res.arrayBuffer())
        const parsed = await parseTorrent(buf)
        validateLinkedTorrent(parsed, ep)
        parsed.urlList = [ep.url]
        parsed.announce = []
        const newBuf = toTorrentFile(parsed)
        const torrentPath = `torrents/${parsed.infoHash}.torrent`
        writeFileSync(`dist/${torrentPath}`, newBuf)
        ep.infoHash = parsed.infoHash
        ep.size = parsed.length
        ep.torrentFileName = parsed.files[0].name
        ep.torrentPath = torrentPath
        count++
        console.log(`✔ Ep ${ep.episode} (${ep.resolution}p): hash ${parsed.infoHash}`)
      } catch (err) {
        console.error(`Error descargando ${torrentUrl}:`, err.message)
      }
      await new Promise(resolve => setTimeout(resolve, 300))
    } else {
      console.log(`✖ No encontrado en Nyaa: Ep ${ep.episode} (${ep.resolution}p, CRC ${ep.crc32})`)
    }
  }

  writeFileSync('raw-catalog.json', JSON.stringify(catalog, null, 2))
  console.log(`\n¡Completado! ${count} torrents oficiales vinculados con webseed directo de Japan-Paw.`)
}
main().catch(console.error)
