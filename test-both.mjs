import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('./dist/indexed-catalog.json', 'utf8'))
const mockFetch = async () => ({
  ok: true,
  status: 200,
  json: async () => catalog
})
globalThis.fetch = mockFetch

async function testAll() {
  console.log('--- Probando Solución Dual (Torrent + WebSeed) ---')

  // 1. Probar TorrentSource
  const { default: torrentExt } = await import('./dist/torrent.js')
  assert.equal(await torrentExt.test(), true)
  const torrentResults = await torrentExt.single({
    titles: ['Sayonara Lara'],
    episode: 1,
    fetch: mockFetch
  })
  console.log(`✔ TorrentSource: ${torrentResults.length} torrents encontrados para Sayonara Lara Ep 1`)
  assert.equal(torrentResults.length, 2, 'Debe devolver 1080p y 720p')
  assert.ok(torrentResults[0].link.includes('.torrent'), 'Debe enlazar a un .torrent')
  assert.ok(torrentResults[0].hash, 'Debe tener infoHash válido')
  console.log('  1080p:', torrentResults[0].title, torrentResults[0].link)
  console.log('  720p:', torrentResults[1].title, torrentResults[1].link)

  // 2. Probar WebSeedSource
  const { default: webseedExt } = await import('./dist/http.js')
  assert.equal(await webseedExt.test(), true)
  const webseedResult = await webseedExt.single({
    name: torrentResults[0].title,
    file: { name: torrentResults[0].title, index: 0 },
    titles: ['Sayonara Lara'],
    episode: 1,
    fetch: mockFetch
  })
  console.log('✔ WebSeedSource: enlace resuelto para streaming HTTP:')
  console.log('  URL:', webseedResult.url)
  assert.ok(webseedResult.url.includes('emision.craftervault.com'))

  console.log('\n¡Todos los tests pasaron exitosamente!')
}
testAll().catch(err => { console.error('Error:', err); process.exit(1) })
