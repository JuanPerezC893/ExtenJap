import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const CHAPTERS_FILE = 'chapters.json'
const CATALOG_FILE = 'raw-catalog.json'

function cleanChapterUrl(rawUrl) {
  if (!rawUrl) return null
  let url = rawUrl.trim()

  // Extraer URL real de acortadores shortxlinks si existen
  if (url.includes('shortxlinks.com')) {
    const m = url.match(/url=([^&]+)/)
    if (m) {
      let target = decodeURIComponent(m[1])
      if (!target.startsWith('http')) target = 'https://' + target
      url = target
    }
  }

  // Migrar dominios antiguos caídos a la infraestructura activa de craftervault
  url = url.replace(/anibatchddl\.com/g, 'craftervault.com')
  url = url.replace(/occi\.j-paw\.xyz/g, 'occi.craftervault.com')
  url = url.replace(/^https?:\/\/https?:\/\//i, 'https://')

  // Descartar rutas que no terminen en un contenedor de video soportado
  if (!/\.(mkv|mp4|webm|avi|m4v)$/i.test(url.split('?')[0])) return null

  return url
}

function parseEpisodeNumber(chapterTitle, fileName) {
  const m1 = chapterTitle.match(/(?:Cap[íi]tulo|Episodio|Ep\.?)\s*0*(\d+(?:\.\d+)?)/i)
  if (m1) return parseFloat(m1[1])
  const m2 = fileName.match(/(?:[\s\-_]0*(\d{1,4}(?:\.\d+)?)[\s\-_]|E0*(\d{1,4}))/i)
  if (m2) return parseFloat(m2[1] || m2[2])
  return 1
}

function main() {
  console.log(`Cargando ${CHAPTERS_FILE}...`)
  const chaptersData = JSON.parse(readFileSync(CHAPTERS_FILE, 'utf8'))

  const existingCatalog = existsSync(CATALOG_FILE) ? JSON.parse(readFileSync(CATALOG_FILE, 'utf8')) : []
  console.log(`Catálogo actual tiene ${existingCatalog.length} series.`)

  // Índice de episodios que ya tienen torrents para conservarlos
  const existingMap = new Map()
  for (const s of existingCatalog) {
    const key = s.sourceV ?? s.title.toLowerCase().trim()
    existingMap.set(key, s)
  }

  const mergedCatalog = []
  const seenKeys = new Set()
  let totalEpisodes = 0
  let preservedTorrents = 0

  for (const item of chaptersData) {
    const vMatch = item.page_url?.match(/v=(\d+)/)
    const sourceV = vMatch ? parseInt(vMatch[1], 10) : null
    const title = item.page_title?.replace(/ - Japan-Paw!.*$/i, '').trim()
    if (!title) continue

    const key = sourceV ?? title.toLowerCase()
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const existingSeries = existingMap.get(key)
    const existingEpMap = new Map()
    if (existingSeries?.episodes) {
      for (const ep of existingSeries.episodes) {
        existingEpMap.set(`${ep.episode}_${ep.resolution}`, ep)
      }
    }

    const episodes = []

    for (const ver of (item.versions || [])) {
      const versionName = ver.version_name || ''
      const resMatch = versionName.match(/(\d{3,4})p/)
      const resolution = resMatch ? resMatch[1] : ''

      for (const chap of (ver.chapters || [])) {
        const cleanUrl = cleanChapterUrl(chap.chapter_url)
        if (!cleanUrl) continue

        const fileName = decodeURIComponent(cleanUrl.split('/').pop() ?? '')
        const epNum = parseEpisodeNumber(chap.chapter_title, fileName)
        const crcMatch = fileName.match(/\[([0-9A-Fa-f]{8})\]/)
        const crc32 = crcMatch ? crcMatch[1].toUpperCase() : null
        const groupMatch = fileName.match(/^\[([^\]]+)\]/)
        const group = groupMatch ? groupMatch[1] : null

        // Si ya existía este episodio con torrent vinculado, conservar el torrentPath y hash
        const epKey = `${epNum}_${resolution}`
        const existingEp = existingEpMap.get(epKey)

        if (existingEp?.torrentPath && existingEp?.infoHash) {
          episodes.push({
            ...existingEp,
            url: cleanUrl,
            isOnline: true
          })
          preservedTorrents++
        } else {
          episodes.push({
            episode: epNum,
            resolution,
            quality: versionName,
            fileName,
            crc32,
            group,
            url: cleanUrl,
            isOnline: true
          })
        }
        totalEpisodes++
      }
    }

    if (episodes.length > 0) {
      mergedCatalog.push({
        sourceV,
        title,
        episodes
      })
    }
  }

  // Añadir también las series del catálogo previo que no estaban en chapters.json (las recientes v=7880..7905)
  for (const s of existingCatalog) {
    const key = s.sourceV ?? s.title.toLowerCase().trim()
    if (!seenKeys.has(key)) {
      seenKeys.add(key)
      mergedCatalog.push(s)
      totalEpisodes += s.episodes?.length ?? 0
      preservedTorrents += (s.episodes ?? []).filter(e => e.torrentPath).length
    }
  }

  // Ordenar por sourceV descendente (más nuevas primero)
  mergedCatalog.sort((a, b) => (b.sourceV || 0) - (a.sourceV || 0))

  writeFileSync(CATALOG_FILE, JSON.stringify(mergedCatalog, null, 2))
  console.log(`\n✔ Proceso completado exitosamente:`)
  console.log(`- Total de series en catálogo: ${mergedCatalog.length}`)
  console.log(`- Total de episodios listos: ${totalEpisodes}`)
  console.log(`- Torrents previamente vinculados conservados: ${preservedTorrents}`)
  console.log(`- Guardado en ${CATALOG_FILE}`)
}

main()
