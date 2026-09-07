import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import parseTorrent from 'parse-torrent'
import { readJson } from './lib/io.mjs'

// Verificación acotada: primera, central y última pieza. No reproduce el video.
const series = readJson('dist/indexed-catalog.json').find(s => s.sourceV === Number(process.argv[2] ?? 7901))
const episode = series?.episodes.find(e => e.episode === Number(process.argv[3] ?? 1) && e.resolution === (process.argv[4] ?? '720'))
if (!episode) throw new Error('Primero genera el torrent con hash.mjs')
const torrent = await parseTorrent(readFileSync(join('dist', episode.torrentPath)))
if (torrent.infoHash !== episode.infoHash) throw new Error('El catálogo no coincide con el torrent')
for (const index of new Set([0, Math.floor(torrent.pieces.length / 2), torrent.pieces.length - 1])) {
  const start = index * torrent.pieceLength
  const end = Math.min(start + torrent.pieceLength, torrent.length) - 1
  const res = await fetch(torrent.urlList[0], { headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(60_000) })
  if (res.status !== 206 || res.headers.get('content-range') !== `bytes ${start}-${end}/${torrent.length}`) {
    await res.body?.cancel()
    throw new Error(`Range inválido, pieza ${index}: HTTP ${res.status}`)
  }
  const data = Buffer.from(await res.arrayBuffer())
  if (data.length !== end - start + 1 || createHash('sha1').update(data).digest('hex') !== torrent.pieces[index]) throw new Error(`Hash incorrecto: pieza ${index}`)
  console.log(`Pieza ${index + 1}/${torrent.pieces.length}: SHA-1 correcto (${data.length} bytes)`)
}
console.log(`Verificado: ${episode.infoHash}`)
