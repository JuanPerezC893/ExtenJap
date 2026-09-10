import { readFileSync, writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { writeJson } from './lib/io.mjs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import parseTorrent from 'parse-torrent'
import { directUrl } from './lib/direct-url.js'
import { replayJournal } from './lib/indexer-journal.js'
import { build } from 'esbuild'

const args = process.argv.slice(2)
let stateDir = process.cwd(), baseArg
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--state-dir' && args[i + 1] && !args[i + 1].startsWith('--')) stateDir = resolve(args[++i])
  else if (!args[i].startsWith('--') && !baseArg) baseArg = args[i]
  else throw new Error('Uso: node build.mjs [URL-base] [--state-dir directorio]')
}
const dist = resolve(stateDir, 'dist')
const output = file => {
  const path = resolve(dist, file), rel = relative(dist, path)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Ruta de torrent fuera de dist')
  return path
}
const registryPath = resolve(stateDir, 'verified-matches.json')
const verified = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, 'utf8')) : { series: {} }
if (!verified.series || typeof verified.series !== 'object' || Array.isArray(verified.series)) throw new Error('Registro inválido; distribución conservada')
replayJournal(resolve(stateDir, 'indexer-journal.jsonl'), { jobs: {} }, verified, { repairTail: false })
const previous = existsSync(output('manifest.json')) ? JSON.parse(readFileSync(output('manifest.json'), 'utf8')) : []
const base = new URL(baseArg ?? (previous[0]?.code ? new URL('./', previous[0].code).href : 'https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/'))
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) throw new Error('Usa una URL base HTTP sin query ni fragmento')
if (!base.pathname.endsWith('/')) base.pathname += '/'
mkdirSync(dist, { recursive: true })

// 1. Inyectar BASE_URL en torrent.js y empaquetar con esbuild
const torrentCode = readFileSync('torrent.js', 'utf8').replace(/const BASE_URL = [^\r\n]+/, `const BASE_URL = ${JSON.stringify(base.href)}`)
async function bundle(code, name) {
  const result = await build({ stdin: { contents: code, resolveDir: process.cwd(), sourcefile: name }, bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022' })
  return result.outputFiles[0].text
}
writeFileSync(output('torrent.js'), await bundle(torrentCode, 'torrent.js'))

// 2. Crear manifest con la extensión única Japan-Paw Direct (con WebSeeds embebidos BEP-19)
const manifest = [
  {
    manifestVersion: 2,
    name: 'Japan-Paw Direct',
    id: 'japanpaw-direct',
    version: '0.4.3',
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

writeJson(output('manifest.json'), manifest)
writeJson(output('index.json'), manifest.map(m => ({ ...m, update: new URL('index.json', base).href })))
writeFileSync(output('icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27344a"/><path d="M25 16v32l25-16z" fill="#a4d6f7"/></svg>')

// 3. Purgar y regenerar dist/data/ con series que tengan verificación REAL de piezas
// output() verifies the absolute target remains under this state's dist directory.
rmSync(output('data'), { recursive: true, force: true })
mkdirSync(output('data'), { recursive: true })
const dataIndex = []

{
  for (const [sKey, sData] of Object.entries(verified.series || {})) {
    if (sData.anilistId) {
      const verifiedEpisodes = (sData.episodes || []).filter(e => {
        const hasPieces = e.verified?.piecesVerified === true
        const torrentOk = e.torrentPath && existsSync(output(e.torrentPath))
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
        const filePath = output(`data/${sData.anilistId}.json`)
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
  writeJson(output('data/index.json'), dataIndex)
  console.log(`Catálogo dividido: ${dataIndex.length} series verificadas publicadas en dist/data/`)
}

console.log(`Preparado: ${new URL('manifest.json', base)}`)
