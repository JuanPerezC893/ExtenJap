import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { writeJson } from './lib/io.mjs'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8787/')
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) throw new Error('Usa una URL base HTTP sin query ni fragmento')
if (!base.pathname.endsWith('/')) base.pathname += '/'
mkdirSync('dist', { recursive: true })

const code = readFileSync('index.js', 'utf8').replace(/const INDEX_URL = [^\r\n]+/, `const INDEX_URL = ${JSON.stringify(new URL('indexed-catalog.json', base).href)}`)
writeFileSync('dist/index.js', code)

const manifest = [{
  manifestVersion: 2,
  name: 'Japan-Paw Direct',
  id: 'japanpaw-direct',
  version: '0.3.0',
  description: 'Aceleración HTTP directa (WebSeed) para episodios desde Japan-Paw.',
  type: 'http',
  accuracy: 'high',
  icon: new URL('icon.svg', base).href,
  media: 'sub',
  languages: ['ALL'],
  url: Buffer.from(base.origin).toString('base64'),
  code: new URL('index.js', base).href,
  update: new URL('manifest.json', base).href
}]
writeJson('dist/manifest.json', manifest)
writeJson('dist/index.json', [{ ...manifest[0], update: new URL('index.json', base).href }])
writeFileSync('dist/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27344a"/><path d="M25 16v32l25-16z" fill="#a4d6f7"/></svg>')

if (existsSync('raw-catalog.json')) {
  const raw = JSON.parse(readFileSync('raw-catalog.json', 'utf8'))
  const indexed = raw.map(series => ({
    sourceV: series.sourceV,
    title: series.title,
    aliases: series.aliases ?? [],
    anilistId: series.anilistId,
    episodes: (series.episodes ?? []).map(ep => {
      const fileName = ep.fileName || decodeURIComponent(new URL(ep.url).pathname.split('/').pop() ?? '')
      const crcMatch = fileName.match(/\[([0-9A-Fa-f]{8})\]/)
      const crc32 = ep.crc32 || (crcMatch ? crcMatch[1].toUpperCase() : null)
      const groupMatch = fileName.match(/^\[([^\]]+)\]/)
      const group = ep.group || (groupMatch ? groupMatch[1] : null)
      return {
        episode: ep.episode,
        resolution: ep.resolution,
        quality: ep.quality,
        fileName,
        crc32,
        group,
        url: ep.url
      }
    })
  }))
  writeJson('dist/indexed-catalog.json', indexed)
  console.log(`Catálogo indexado: ${indexed.length} series`)
} else if (!existsSync('dist/indexed-catalog.json')) {
  writeJson('dist/indexed-catalog.json', [])
}

console.log(`Preparado: ${new URL('manifest.json', base)}`)

