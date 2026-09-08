import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { writeJson } from './lib/io.mjs'
import { build } from 'esbuild'

const previous = existsSync('dist/manifest.json') ? JSON.parse(readFileSync('dist/manifest.json', 'utf8')) : []
const base = new URL(process.argv[2] ?? (previous[0]?.code ? new URL('./', previous[0].code).href : 'https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/'))
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) throw new Error('Usa una URL base HTTP sin query ni fragmento')
if (!base.pathname.endsWith('/')) base.pathname += '/'
mkdirSync('dist', { recursive: true })

// 1. Inyectar BASE_URL en torrent.js y empaquetar con esbuild
const torrentCode = readFileSync('torrent.js', 'utf8').replace(/const BASE_URL = [^\r\n]+/, `const BASE_URL = ${JSON.stringify(base.href)}`)
async function bundle(code, name) {
  const result = await build({ stdin: { contents: code, resolveDir: process.cwd(), sourcefile: name }, bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  return result.outputFiles[0].text
}
writeFileSync('dist/torrent.js', await bundle(torrentCode, 'torrent.js'))

// 2. Crear manifest con la extensión única Japan-Paw Direct (con WebSeeds embebidos BEP-19)
const manifest = [
  {
    manifestVersion: 2,
    name: 'Japan-Paw Direct',
    id: 'japanpaw-direct',
    version: '0.3.8',
    description: 'Catálogo pre-verificado con aceleración WebSeed directa desde Japan-Paw.',
    type: 'torrent',
    accuracy: 'high',
    icon: new URL('icon.svg', base).href,
    media: 'sub',
    languages: ['ALL'],
    url: Buffer.from(base.origin).toString('base64'),
    code: new URL('torrent.js', base).href,
    update: new URL('manifest.json', base).href
  }
]

writeJson('dist/manifest.json', manifest)
writeJson('dist/index.json', manifest.map(m => ({ ...m, update: new URL('index.json', base).href })))
writeFileSync('dist/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27344a"/><path d="M25 16v32l25-16z" fill="#a4d6f7"/></svg>')

// 3. Purgar y regenerar dist/data/ con series que tengan verificación REAL de piezas
rmSync('dist/data', { recursive: true, force: true })
mkdirSync('dist/data', { recursive: true })
const dataIndex = []

if (existsSync('verified-matches.json')) {
  const verified = JSON.parse(readFileSync('verified-matches.json', 'utf8'))
  for (const [sKey, sData] of Object.entries(verified.series || {})) {
    if (sData.anilistId) {
      const verifiedEpisodes = (sData.episodes || []).filter(e => {
        const hasPieces = e.verified?.piecesVerified === true
        const torrentOk = e.torrentPath && existsSync(`dist/${e.torrentPath}`)
        return hasPieces && torrentOk
      }).map(e => ({
        episode: e.episode,
        resolution: String(e.resolution),
        quality: e.quality,
        fileName: e.fileName,
        size: e.size,
        hash: e.infoHash,
        torrent: e.torrentPath,
        url: e.directUrl,
        verified: true,
        verifiedAt: e.verified?.verifiedAt
      }))

      if (verifiedEpisodes.length > 0) {
        const filePath = `dist/data/${sData.anilistId}.json`
        const animeData = {
          anilistId: sData.anilistId,
          title: sData.title,
          episodes: verifiedEpisodes
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
  }
  writeJson('dist/data/index.json', dataIndex)
  console.log(`Catálogo dividido: ${dataIndex.length} series verificadas publicadas en dist/data/`)
}

console.log(`Preparado: ${new URL('manifest.json', base)}`)
