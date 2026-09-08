import { sameRelease, VIDEO } from './matching.js'
export function validateLinkedTorrent(parsed, ep) {
  if (parsed.files.length !== 1 || !VIDEO.test(parsed.files[0].name)) throw new Error('Se requiere un torrent de un único archivo de video')
  if (!sameRelease(ep, parsed.files[0].name)) throw new Error('El torrent no corresponde al archivo de Japan-Paw')
  if (ep.size && Number(ep.size) !== parsed.length) throw new Error('El tamaño del archivo no coincide')
}
