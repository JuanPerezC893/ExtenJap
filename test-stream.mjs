import createTorrent from 'create-torrent'
import parseTorrent, { toMagnetURI } from 'parse-torrent'
import { Readable } from 'node:stream'

// Usamos un archivo real pequeño de un dominio permitido para simular
// el mismo flujo que se usaría con un video real (fetch -> stream -> hash)
const testUrl = 'https://raw.githubusercontent.com/hayase-app/torrent-client/main/package.json'

const res = await fetch(testUrl)
if (!res.ok) throw new Error('fetch failed: ' + res.status)

const nodeStream = Readable.fromWeb(res.body)

createTorrent(nodeStream, {
  name: 'test-file.json',
  urlList: [testUrl],
  private: false
}, async (err, torrentBuf) => {
  if (err) throw err
  const parsed = await parseTorrent(torrentBuf)
  console.log('infoHash:', parsed.infoHash)
  console.log('length (bytes, descubierto leyendo el stream):', parsed.length)
  console.log('urlList:', parsed.urlList)
  console.log('\nmagnet:\n', toMagnetURI(parsed))
})
