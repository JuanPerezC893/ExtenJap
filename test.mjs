import createTorrent from 'create-torrent'
import parseTorrent, { toMagnetURI } from 'parse-torrent'
import { writeFileSync } from 'node:fs'

// Simula un archivo de video con contenido determinista
const fakeVideo = Buffer.alloc(5 * 1024 * 1024) // 5MB
for (let i = 0; i < fakeVideo.length; i++) fakeVideo[i] = i % 256
writeFileSync('/tmp/fake-episode-01.mkv', fakeVideo)

createTorrent('/tmp/fake-episode-01.mkv', {
  name: '[Erai-raws] Fake Show - 01 [1080p].mkv',
  urlList: ['https://example.com/fake-episode-01.mkv'],
  private: false
}, async (err, torrentBuf) => {
  if (err) throw err
  const parsed = await parseTorrent(torrentBuf)
  console.log('infoHash:', parsed.infoHash)
  console.log('pieceLength:', parsed.pieceLength)
  console.log('numPieces:', parsed.pieces.length)
  console.log('urlList (parsed back from .torrent):', parsed.urlList)

  const magnet = toMagnetURI(parsed)
  console.log('\nmagnet URI:\n', magnet)

  // Confirmar que el magnet generado, al re-parsearlo, SIGUE trayendo el ws= como urlList
  const reparsed = await parseTorrent(magnet)
  console.log('\nRe-parsed magnet urlList:', reparsed.urlList)
  console.log('Re-parsed magnet infoHash matches:', reparsed.infoHash === parsed.infoHash)
})
