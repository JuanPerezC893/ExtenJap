import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { writeJson } from './lib/io.mjs'
const base = new URL(process.argv[2] ?? 'http://127.0.0.1:8787/')
if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash) throw new Error('Usa una URL base HTTP sin query ni fragmento')
if (!base.pathname.endsWith('/')) base.pathname += '/'
mkdirSync('dist', { recursive: true })
const code = readFileSync('index.js', 'utf8').replace(/const INDEX_URL = [^\r\n]+/, `const INDEX_URL = ${JSON.stringify(new URL('indexed-catalog.json', base).href)}`)
writeFileSync('dist/index.js', code)
const manifest = [{
  manifestVersion: 2, name: 'Japan-Paw Direct', id: 'japanpaw-direct', version: '0.2.0',
  description: 'Episodios por HTTP mediante metadatos torrent y webseeds.',
  type: 'torrent', accuracy: 'low', icon: new URL('icon.svg', base).href,
  media: 'sub', languages: ['ALL'], url: Buffer.from(base.origin).toString('base64'),
  code: new URL('index.js', base).href, update: new URL('manifest.json', base).href
}]
writeJson('dist/manifest.json', manifest)
writeJson('dist/index.json', [{ ...manifest[0], update: new URL('index.json', base).href }])
writeFileSync('dist/icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#27344a"/><path d="M25 16v32l25-16z" fill="#a4d6f7"/></svg>')
if (!existsSync('dist/indexed-catalog.json')) writeJson('dist/indexed-catalog.json', [])
console.log(`Preparado: ${new URL('manifest.json', base)}`)
