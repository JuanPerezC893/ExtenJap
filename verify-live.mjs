// Opt-in network smoke test; never runs as part of npm test.
import fs from 'node:fs'
import { createTorrentSource } from './torrent.js'
import { createHTTPSource } from './http.js'
import parseTorrent from 'parse-torrent'
import { createHash } from 'node:crypto'
const base = 'https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/'
const catalog = JSON.parse(fs.readFileSync('raw-catalog.json', 'utf8'))
const localFetch = async (url, options) => {
  if (url === base + 'indexed-catalog.json') return Response.json(catalog)
  if (url.startsWith(base + 'torrents/')) {
    const path = 'dist/' + url.slice(base.length)
    if (fs.existsSync(path)) return new Response(fs.readFileSync(path))
  }
  return fetch(url, options)
}
const cases = [
  { title: 'Mashle 2nd Season', episode: 2 },
  { title: 'Hime Kishi wa Barbaroi no Yome', episode: 2 },
  { title: 'Sayonara Lara', episode: 1 }
]
for (const item of cases) {
  const series = catalog.find(s => s.title === item.title)
  if (!series) throw new Error(`Missing series ${item.title}`)
  const source = createTorrentSource(base + 'indexed-catalog.json')
  const http = createHTTPSource(base + 'indexed-catalog.json')
  const query = { titles: [series.title, ...(series.aliases || [])], anilistId: series.anilistId, episode: item.episode, fetch: localFetch }
  const results = await source.single(query)
  console.log(`${item.title} ${item.episode}: ${results.length} coincidencias de archivo validadas`)
  for (const result of results) {
    const response = await localFetch(result.link, { signal: AbortSignal.timeout(10000) })
    const parsed = await parseTorrent(new Uint8Array(await response.arrayBuffer()))
    const seed = await http.single({ ...query, name: parsed.name, file: { name: parsed.files[0].name, index: 0 } })
    if (!seed) throw new Error(`No HTTP mapping for ${parsed.name}`)
    if (process.argv.includes('--pieces')) {
      for (const i of new Set([0, parsed.pieces.length - 1])) {
        const start = i * parsed.pieceLength
        const end = Math.min(start + parsed.pieceLength, parsed.length) - 1
        const res = await fetch(seed.url, { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) })
        if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${parsed.length}`) { await res.body?.cancel(); throw new Error('Invalid HTTP Range') }
        const piece = new Uint8Array(await res.arrayBuffer())
        if (createHash('sha1').update(piece).digest('hex') !== parsed.pieces[i]) throw new Error(`Wrong SHA-1: ${parsed.name}, piece ${i}`)
      }
      console.log('  Primera y última pieza SHA-1: correctas')
    }
    console.log(JSON.stringify({ name: parsed.name, size: parsed.length, hash: parsed.infoHash, webseed: new URL(seed.url).hostname }))
  }
  if (!results.length) process.exitCode = 1
}
