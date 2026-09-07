import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, sep, extname } from 'node:path'
const root = resolve('dist')
const types = { '.json': 'application/json', '.js': 'text/javascript', '.torrent': 'application/x-bittorrent', '.svg': 'image/svg+xml' }
createServer(async (req, res) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }

  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/' || pathname === '/index.json') {
      pathname = '/manifest.json'
    }
    const path = resolve(root, '.' + pathname)
    if (!path.startsWith(root + sep)) { res.writeHead(403); res.end(); return }
    const data = await readFile(path)
    res.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Content-Length': data.length })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch { res.writeHead(404); res.end('No encontrado') }
}).listen(8787, '0.0.0.0', () => {
  console.log('Repositorio local listo en:')
  console.log('  http://127.0.0.1:8787/manifest.json')
  console.log('  http://localhost:8787/manifest.json')
})
