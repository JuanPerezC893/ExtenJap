import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { writeJson } from './lib/io.mjs'
import { build } from 'esbuild'

const previous = existsSync('dist/manifest.json') ? JSON.parse(readFileSync('dist/manifest.json', 'utf8')) : []
const base = new URL(process.argv[2] ?? (previous[0]?.code ? new URL('./', previous[0].code).href : 'http://127.0.0.1:8787/'))
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) throw new Error('Usa una URL base HTTP sin query ni fragmento')
if (!base.pathname.endsWith('/')) base.pathname += '/'
mkdirSync('dist', { recursive: true })

// 1. Inyectar INDEX_URL en torrent.js
const torrentCode = readFileSync('torrent.js', 'utf8').replace(/const INDEX_URL = [^\r\n]+/, `const INDEX_URL = ${JSON.stringify(new URL('indexed-catalog.json', base).href)}`)
async function bundle(code, name) {
  const result = await build({ stdin: { contents: code, resolveDir: process.cwd(), sourcefile: name }, bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022', alias: { path: 'path-browserify' } })
  return result.outputFiles[0].text
}
writeFileSync('dist/torrent.js', await bundle(torrentCode, 'torrent.js'))

// 2. Inyectar INDEX_URL en http.js y dist/index.js
const httpCode = readFileSync('http.js', 'utf8').replace(/const INDEX_URL = [^\r\n]+/, `const INDEX_URL = ${JSON.stringify(new URL('indexed-catalog.json', base).href)}`)
const bundledHTTP = await bundle(httpCode, 'http.js')
writeFileSync('dist/http.js', bundledHTTP)
writeFileSync('dist/index.js', bundledHTTP)

// 3. Crear manifest con ambos componentes: Torrent y WebSeed
const manifest = [
  {
    manifestVersion: 2,
    name: 'Japan-Paw Direct',
    id: 'japanpaw-direct',
    version: '0.3.7',
    description: 'Catálogo pre-verificado con aceleración WebSeed directa desde Japan-Paw.',
    type: 'torrent',
    accuracy: 'high',
    icon: new URL('icon.svg', base).href,
    media: 'sub',
    languages: ['ALL'],
    url: Buffer.from(base.origin).toString('base64'),
    code: new URL('torrent.js', base).href,
    update: new URL('manifest.json', base).href
  },
  {
    manifestVersion: 2,
    name: 'Japan-Paw WebSeed',
    id: 'japanpaw-webseed',
    version: '0.3.7',
    description: 'Aceleración HTTP directa (WebSeed) para episodios desde Japan-Paw.',
    type: 'http',
    accuracy: 'medium',
    icon: new URL('icon.svg', base).href,
    media: 'sub',
    languages: ['ALL'],
    url: Buffer.from(base.origin).toString('base64'),
    code: new URL('http.js', base).href,
    update: new URL('manifest.json', base).href
  }
]

writeJson('dist/manifest.json', manifest)
writeJson('dist/index.json', manifest.map(m => ({ ...m, update: new URL('index.json', base).href })))
writeFileSync('dist/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27344a"/><path d="M25 16v32l25-16z" fill="#a4d6f7"/></svg>')

// 4. Generar catálogo dividido por anime en dist/data/<anilistId>.json
mkdirSync('dist/data', { recursive: true })
const dataIndex = []
if (existsSync('verified-matches.json')) {
  const verified = JSON.parse(readFileSync('verified-matches.json', 'utf8'))
  for (const [sKey, sData] of Object.entries(verified.series || {})) {
    if (sData.anilistId) {
      const filePath = `dist/data/${sData.anilistId}.json`
      const animeData = {
        anilistId: sData.anilistId,
        title: sData.title,
        episodes: (sData.episodes || []).map(e => ({
          episode: e.episode,
          resolution: String(e.resolution),
          quality: e.quality,
          fileName: e.fileName,
          size: e.size,
          hash: e.infoHash,
          torrent: e.torrentPath,
          url: e.directUrl,
          verified: true
        }))
      }
      writeJson(filePath, animeData)
      dataIndex.push({
        anilistId: sData.anilistId,
        title: sData.title,
        episodesCount: animeData.episodes.length,
        file: `data/${sData.anilistId}.json`
      })
    }
  }
  writeJson('dist/data/index.json', dataIndex)
  console.log(`Catálogo dividido: ${dataIndex.length} series generadas en dist/data/`)
}

// 5. Copiar raw-catalog.json a dist/indexed-catalog.json
if (existsSync('raw-catalog.json')) {
  const raw = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))
  writeJson('dist/indexed-catalog.json', raw)
  console.log(`Catálogo indexado: ${raw.length} series (${raw[0]?.episodes?.length ?? 0} episodios en serie 1)`)
}

console.log(`Preparado: ${new URL('manifest.json', base)}`)
