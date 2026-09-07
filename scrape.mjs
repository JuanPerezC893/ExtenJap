#!/usr/bin/env node
// scrape.mjs — Recorre paste.japan-paw.net/?v=N y extrae serie + episodios + links limpios.
// Reanudable: si raw-catalog.json ya existe, salta los "v" ya scrapeados.
//
// Uso:
//   node scrape.mjs [desde] [hasta]
//   node scrape.mjs 1 8000
//
// Variables de entorno opcionales:
//   DELAY_MS=800   -> pausa entre requests (subir si el sitio empieza a bloquear)

import { readFileSync, existsSync } from 'node:fs'
import { isMain, writeJson } from './lib/io.mjs'

const OUTPUT_FILE = './raw-catalog.json'
const START = parseInt(process.argv[2] ?? '1', 10)
const END = parseInt(process.argv[3] ?? '8000', 10)
const DELAY_MS = parseInt(process.env.DELAY_MS ?? '800', 10)
const MAX_RETRIES = 3

// User-Agent de navegador real: el sitio tiene detección de bots, un fetch
// "desnudo" (sin este header, o con el UA por defecto de Node) puede ser bloqueado.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Limpia el link: si viene envuelto en redirect.japan-paw.net/#<encoded>,
// decodifica SOLO el esquema (https%3A%2F%2F -> https://) y deja el resto
// del path tal cual (ya viene correctamente percent-encoded para una URL).
// Si el link ya es directo (sin el wrapper), se devuelve sin cambios.
export function cleanUrl(href) {
  const decoded = href.replace(/&amp;/gi, '&')
  const wrapper = new URL(decoded)
  const raw = wrapper.hostname === 'redirect.japan-paw.net' ? wrapper.hash.slice(1) : decoded
  const url = new URL(raw.replace(/^(https?)%3A%2F%2F/i, '$1://'))
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('URL no HTTP')
  return url.href
}

// Extensiones de video soportadas para streaming
const VIDEO_EXTENSIONS = /\.(mkv|mp4|webm|avi|m4v)$/i

// Parser validado contra ejemplos reales de paste.japan-paw.net
export function parseSeries(html) {
  const titleMatch = html.match(/<h2\b[^>]*>\s*([\s\S]*?)\s*<\/h2>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null
  if (!title) return null

  // id de tab -> etiqueta de calidad, ej. "tab_content_2" -> "[Erai-raws][Web 1080p]"
  const tabLabels = new Map()
  const tabListRe = /tab-target="#(tab_content_\d+)"[\s\S]*?<span>([^<]+)<\/span>/g
  let t
  while ((t = tabListRe.exec(html))) tabLabels.set(t[1], t[2].trim())

  const parts = html.split(/<div id="(tab_content_\d+)" class="tab_content/)
  const episodes = []

  for (let i = 1; i < parts.length; i += 2) {
    const tabId = parts[i]
    const chunk = parts[i + 1] || ''
    const quality = tabLabels.get(tabId) || ''
    const resMatch = quality.match(/(\d{3,4})p/)
    const resolution = resMatch ? resMatch[1] : ''

    // Solo nos interesa lo que viene DESPUÉS de "Publicos-Paste.png":
    // antes de eso está la sección VIP (bloqueada, sin links reales).
    const publicIdx = chunk.indexOf('Publicos-Paste.png')
    const searchArea = publicIdx >= 0 ? chunk.slice(publicIdx) : ''

    const linkRe = /<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let lm
    while ((lm = linkRe.exec(searchArea))) {
      let url
      try { url = cleanUrl(lm[1]) } catch { continue }

      const fileName = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')

      // Filtro estricto: descartar juegos, música, software, archivos .rar, .zip, etc.
      if (!VIDEO_EXTENSIONS.test(fileName)) continue

      // Extraer número de episodio desde el texto del enlace o desde el nombre del archivo
      const text = lm[2].replace(/<[^>]+>/g, '').trim()
      const epMatch = text.match(/(?:Cap[íi]tulo|Episodio|Ep\.?)\s*0*(\d+)/i) ||
                      fileName.match(/(?:[\s\-_]0*(\d{1,4})[\s\-_]|E0*(\d{1,4}))/i)
      const epNum = epMatch ? parseInt(epMatch[1] || epMatch[2], 10) : null
      if (epNum === null || !Number.isFinite(epNum)) continue

      if (episodes.some(e => e.url === url && e.episode === epNum)) continue

      const crcMatch = fileName.match(/\[([0-9A-Fa-f]{8})\]/)
      const crc32 = crcMatch ? crcMatch[1].toUpperCase() : null
      const groupMatch = fileName.match(/^\[([^\]]+)\]/)
      const group = groupMatch ? groupMatch[1] : null

      episodes.push({
        episode: epNum,
        resolution,
        quality,
        fileName,
        crc32,
        group,
        url,
        isOnline: true
      })
    }
  }

  return { title, episodes }
}

export async function probeUrl(url, timeoutMs = 5000) {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs)
    })
    return res.status === 206 || res.status === 200
  } catch {
    return false
  }
}

async function fetchPage(v, retries = MAX_RETRIES) {
  const url = `https://paste.japan-paw.net/?v=${v}`
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'es-ES,es;q=0.9'
      }
    })
    if (!res.ok) {
      if (res.status === 429 && retries > 0) {
        await sleep(5000)
        return fetchPage(v, retries - 1)
      }
      return null
    }
    return await res.text()
  } catch (err) {
    if (retries > 0) {
      await sleep(2000)
      return fetchPage(v, retries - 1)
    }
    console.error(`v=${v} falló de red:`, err.message)
    return null
  }
}

function loadExisting() {
  if (!existsSync(OUTPUT_FILE)) return []
  return JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'))
}

async function main() {
  if (process.argv[2] === '--html') {
    const parsed = parseSeries(readFileSync(process.argv[3], 'utf8'))
    if (!parsed?.episodes.length) throw new Error('No se encontraron episodios públicos')
    const sourceV = Number(process.argv[4] ?? 7901)
    const catalog = loadExisting().filter(s => s.sourceV !== sourceV)
    catalog.push({ sourceV, ...parsed })
    writeJson(OUTPUT_FILE, catalog)
    console.log(`${parsed.title}: ${parsed.episodes.length} enlaces guardados`)
    return
  }
  if (!Number.isSafeInteger(START) || !Number.isSafeInteger(END) || START < 1 || END < START || !Number.isFinite(DELAY_MS) || DELAY_MS < 0) throw new Error('Rango o DELAY_MS inválido')
  const catalog = loadExisting()
  const seenV = new Set(catalog.map(e => e.sourceV))

  console.log(`Scrapeando v=${START}..${END} (${seenV.size} ya en caché)`)

  for (let v = START; v <= END; v++) {
    if (seenV.has(v) && !process.argv.includes('--refresh')) continue

    const html = await fetchPage(v)
    if (html) {
      const parsed = parseSeries(html)
      if (parsed && parsed.episodes.length) {
        const entry = { sourceV: v, title: parsed.title, episodes: parsed.episodes }
        const old = catalog.findIndex(s => s.sourceV === v)
        if (old >= 0) catalog[old] = { ...catalog[old], ...entry }
        else catalog.push(entry)
        writeJson(OUTPUT_FILE, catalog)
        console.log(`v=${v}: "${parsed.title}" — ${parsed.episodes.length} episodios`)
      } else {
        console.log(`v=${v}: sin contenido público reconocible, saltando`)
      }
    } else {
      console.log(`v=${v}: no se pudo obtener (bloqueo, 404, o error de red)`)
    }

    if (v % 10 === 0) writeJson(OUTPUT_FILE, catalog)
    await sleep(DELAY_MS)
  }

  writeJson(OUTPUT_FILE, catalog)
  console.log(`\nListo. ${catalog.length} series guardadas en ${OUTPUT_FILE}`)
}

if (isMain(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1 })
