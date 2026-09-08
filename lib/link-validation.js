import { sameRelease, episodeNumber, resolution, VIDEO } from './matching.js'

export function validateLinkedTorrent(parsed, ep) {
  if (parsed.files.length !== 1 || !VIDEO.test(parsed.files[0].name)) {
    throw new Error('Se requiere un torrent de un único archivo de video')
  }

  if (sameRelease(ep, parsed.files[0].name)) {
    if (ep.size && Number(ep.size) !== parsed.length) throw new Error('El tamaño del archivo no coincide')
    return true
  }

  // Fallback si el catálogo tenía un CRC erróneo o duplicado de otro episodio:
  // Si coinciden número de episodio, resolución y grupo fansub, permitimos
  // avanzar a la verificación criptográfica estricta de piezas (SHA-1 HTTP Range).
  const tName = parsed.files[0].name
  const aEp = Number(ep.episode)
  const bEp = episodeNumber(tName)
  const aRes = String(ep.resolution || '').replace(/p$/i, '')
  const bRes = resolution(tName)

  const group = text => String(text).match(/^\[([^\]]+)\]/)?.[1]?.toLowerCase()
  const aGroup = ep.group?.toLowerCase() || group(ep.fileName || '')
  const bGroup = group(tName)

  if (bEp !== null && aEp === bEp && (!aRes || !bRes || aRes === bRes) && (!aGroup || !bGroup || aGroup === bGroup)) {
    return true
  }

  throw new Error('El torrent no corresponde al archivo de Japan-Paw')
}

