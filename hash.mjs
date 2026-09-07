import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'
import { Readable } from 'node:stream'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { isMain, readJson, writeJson } from './lib/io.mjs'

export async function probe(url) {
  const response = await fetch(url, { headers: { Range: 'bytes=0-0', 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30_000) })
  try {
    const range = response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/)
    if (response.status !== 206 || !range) throw new Error(`El servidor no admite Range: HTTP ${response.status}`)
    const byte = await response.arrayBuffer()
    if (byte.byteLength !== 1) throw new Error('Range devolvió una longitud incorrecta')
    const size = Number(range[1])
    if (!Number.isSafeInteger(size) || size < 1) throw new Error('Tamaño inválido')
    return { size, etag: response.headers.get('etag') }
  } finally { if (!response.bodyUsed) await response.body?.cancel() }
}

export async function hashVideo(url, output, { maxBytes = Infinity } = {}) {
  const metadata = await probe(url)
  if (metadata.size > maxBytes) throw new Error(`Archivo de ${metadata.size} bytes supera --max-bytes=${maxBytes}`)
  const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop())
  if (!fileName || /[\\/]/.test(fileName)) throw new Error('Nombre de archivo inválido')
  const response = await fetch(url, {
    headers: { 'Accept-Encoding': 'identity', ...(metadata.etag && !metadata.etag.startsWith('W/') ? { 'If-Match': metadata.etag } : {}) },
    signal: AbortSignal.timeout(3_600_000)
  })
  if (response.status !== 200 || /text\/html|application\/json/i.test(response.headers.get('content-type') ?? '')) {
    await response.body?.cancel()
    throw new Error(`Respuesta no válida para video: HTTP ${response.status}`)
  }
  let size = 0
  let lastProgress = Date.now()
  const stream = Readable.from((async function* () {
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > metadata.size || size > maxBytes) throw new Error('El archivo excedió el tamaño anunciado')
      if (Date.now() - lastProgress > 30_000) {
        console.log(`  ${(100 * size / metadata.size).toFixed(1)}% (${Math.round(size / 1048576)} MiB)`)
        lastProgress = Date.now()
      }
      yield chunk
    }
    if (size !== metadata.size) throw new Error('Descarga incompleta o archivo modificado')
  })())
  stream.name = fileName
  const bytes = await new Promise((resolve, reject) => createTorrent(stream, {
    name: fileName, pieceLength: 1024 * 1024, announceList: [], urlList: [url],
    createdBy: 'Japan-Paw Hayase', creationDate: new Date(0)
  }, (error, data) => error ? reject(error) : resolve(data)))
  const torrent = await parseTorrent(bytes)
  const torrentPath = `torrents/${torrent.infoHash}.torrent`
  mkdirSync(join(output, 'torrents'), { recursive: true })
  writeFileSync(join(output, torrentPath), bytes)
  return { infoHash: torrent.infoHash, size, fileName, torrentPath, hashedAt: new Date().toISOString() }
}

async function main() {
  const { values } = parseArgs({ options: {
    input: { type: 'string', default: 'raw-catalog.json' }, output: { type: 'string', default: 'dist' },
    series: { type: 'string' }, episode: { type: 'string' }, resolution: { type: 'string' },
    limit: { type: 'string', default: '1' }, 'max-bytes': { type: 'string', default: '2147483648' },
    refresh: { type: 'boolean', default: false }
  } })
  const limit = Number(values.limit), maxBytes = Number(values['max-bytes'])
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Límite inválido')
  const catalog = readJson(values.input)
  const target = join(values.output, 'indexed-catalog.json')
  const indexed = readJson(target)
  let count = 0
  for (const series of catalog) {
    if (values.series && String(series.sourceV) !== values.series) continue
    let saved = indexed.find(s => s.sourceV === series.sourceV)
    for (const episode of series.episodes) {
      if (values.episode && episode.episode !== Number(values.episode)) continue
      if (values.resolution && episode.resolution !== values.resolution) continue
      const previous = saved?.episodes.find(e => e.url === episode.url)
      if (!values.refresh && previous?.torrentPath && existsSync(join(values.output, previous.torrentPath))) {
        const parsed = await parseTorrent(readFileSync(join(values.output, previous.torrentPath)))
        if (parsed.infoHash === previous.infoHash) continue
      }
      if (count >= limit) return
      count++
      console.log(`Procesando ${series.title}, episodio ${episode.episode}, ${episode.resolution}p`)
      try {
        const hashed = await hashVideo(episode.url, values.output, { maxBytes })
        if (!saved) { saved = { ...series, episodes: [] }; indexed.push(saved) }
        saved.title = series.title
        if (series.aliases) saved.aliases = series.aliases
        if (series.anilistId) saved.anilistId = series.anilistId
        saved.episodes = saved.episodes.filter(e => !(e.episode === episode.episode && e.resolution === episode.resolution && e.quality === episode.quality))
        saved.episodes.push({ ...episode, ...hashed })
        writeJson(target, indexed)
        console.log(`Guardado ${hashed.torrentPath} (${hashed.size} bytes)`)
      } catch (error) { console.error(error.message); process.exitCode = 1 }
    }
  }
}
if (isMain(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
