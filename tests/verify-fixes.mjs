import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import torrentSource from '../dist/torrent.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const localCat = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../dist/indexed-catalog.json'), 'utf8'))

const testFetch = async (url, opts) => {
  if (url.includes('indexed-catalog.json')) {
    return { ok: true, status: 200, json: async () => localCat }
  }
  return fetch(url, opts)
}

import httpSource from '../dist/http.js'

async function runTests() {
  console.log('=== TEST 1: Himekishi wa Barbaroi no Yome - Episodio 2 (Torrent Provider) ===')
  const r1 = await torrentSource.single({
    fetch: testFetch,
    titles: ['Himekishi wa Barbaroi no Yome', 'The Warrior Princess and the Barbaric King'],
    episode: 2
  })
  console.log(`Encontrados: ${r1.length} resultados`)
  for (const item of r1) {
    console.log(`- Título: ${item.title}`)
    console.log(`  Hash:   ${item.hash}`)
    console.log(`  Tamaño: ${(item.size / 1024 / 1024).toFixed(1)} MB`)
    console.log(`  Link:   ${item.link}`)
  }

  const hasK = r1.some(i => i.title.toLowerCase().includes('k-project') || i.title.toLowerCase().includes('kusuriya') || i.title.toLowerCase().includes('k - 01'))
  console.log(`¿Contiene K-Project o Kusuriya por error?: ${hasK ? 'SI (MALO)' : 'NO (CORRECTO)'}`)

  const allReasonableSize = r1.every(i => i.size < 4 * 1024 * 1024 * 1024)
  console.log(`¿Tamaño correcto de episodio único (< 4 GB)?: ${allReasonableSize ? 'SI (CORRECTO)' : 'NO (MALO)'}`)

  console.log('\n=== TEST 2: HTTP WebSeed Direct Resolver ===')
  const r2 = await httpSource.single({
    fetch: testFetch,
    titles: ['Himekishi wa Barbaroi no Yome'],
    episode: 2,
    file: { name: 'The.Warrior.Princess.and.the.Barbaric.King.S01E02.1080p.CR.WEB-DL.JPN.AAC2.0.H.264.MSubs-ToonsHub.mkv', index: 0 }
  })
  console.log(`Resultado HTTP:`, r2)
  console.log(`¿Resolvió URL de craftervault?: ${r2?.url?.includes('craftervault.com') ? 'SI (CORRECTO)' : 'NO (MALO)'}`)

  console.log('\n=== TEST 3: Película (Kimi no Na wa) - Sin límite de 4.5 GB ===')
  const r3 = await torrentSource.single({
    fetch: testFetch,
    titles: ['Kimi no Na wa', 'Your Name.'],
    episode: 1
  })
  console.log(`Encontrados para película: ${r3.length} resultados`)
  for (const item of r3) {
    console.log(`- Título: ${item.title}`)
    console.log(`  Tamaño: ${(item.size / 1024 / 1024 / 1024).toFixed(2)} GB`)
  }
  const hasMovie = r3.length > 0
  console.log(`¿Película encontrada correctamente sin ser bloqueada por tamaño?: ${hasMovie ? 'SI (CORRECTO)' : 'NO (MALO)'}`)

  console.log('\n=== TEST 4: Verificación directa de Película (15 GB) vs Batch (15 GB) ===')
  // Simulación de los dos casos de 15 GB
  const testMovie = {
    title: '[BlackRose] Your Name. (2016) (BD 1080p HEVC 10-bit Opus) [Dual-Audio] | Kimi no Na wa.',
    num_files: 1,
    total_size: 14_452_000_000 // 14.4 GB
  }
  const testBatch = {
    title: '[Yameii] The Apothecary Diaries - S01 [English Dub] [CR WEB-DL 720p] - Unofficial Batch',
    num_files: 24,
    total_size: 18_210_000_000 // 18.2 GB
  }

  // Importar isBatchTorrent indirectamente o evaluar la lógica
  const isBatchRegex = /\b(batch|unofficial\s*batch|season\s*\d*\s*complete|complete\s*season|complete\s*series|s\d+\s*-\s*s\d+|0?1\s*-\s*\d{2,}|0?1\s*~\s*\d{2,})\b/i
  const checkBatch = (item) => {
    const title = `${item.title || ''} ${item.torrent_name || ''}`.toLowerCase()
    if (isBatchRegex.test(title)) return true
    if (item.num_files && item.num_files > 3) return true
    return false
  }

  console.log(`Película de 14.4 GB con 1 archivo es batch: ${checkBatch(testMovie)} (Debe ser false -> PERMITIDA)`)
  console.log(`Batch de 18.2 GB con 24 archivos es batch: ${checkBatch(testBatch)} (Debe ser true -> FILTRADO)`)

  console.log('\n=== TEST 5: Taboo Tattoo (Tolerancia a errores de tipeo y búsqueda) ===')
  const r5 = await torrentSource.single({
    fetch: testFetch,
    titles: ['Taboo Tattoo'],
    episode: 1
  })
  console.log(`Encontrados para Taboo Tattoo: ${r5.length} resultados`)
  for (const item of r5) {
    console.log(`- Título: ${item.title}`)
    console.log(`  Hash:   ${item.hash}`)
    console.log(`  Tamaño: ${(item.size / 1024 / 1024).toFixed(1)} MB`)
  }
  console.log(`¿Taboo Tattoo encontrado exitosamente?: ${r5.length > 0 ? 'SI (CORRECTO)' : 'NO (MALO)'}`)

  console.log('\n=== TEST 6: Mashle 2nd Season (Separación de resoluciones 1080p vs 720p) ===')
  const r6 = await torrentSource.single({
    fetch: testFetch,
    titles: ['Mashle 2nd Season'],
    episode: 1
  })
  console.log(`Encontrados para Mashle 2nd Season Ep 1: ${r6.length} resultados`)
  for (const item of r6) {
    console.log(`- Título:  ${item.title}`)
    console.log(`  Res:     ${item.episode.resolution}p`)
    console.log(`  Hash:    ${item.hash}`)
    console.log(`  Tamaño:  ${(item.size / 1024 / 1024).toFixed(1)} MB`)
  }

  const has1080 = r6.some(i => i.episode.resolution === '1080')
  const has720 = r6.some(i => i.episode.resolution === '720')
  const distinctHashes = new Set(r6.map(i => i.hash)).size === r6.length
  const noSeason1 = r6.every(i => !i.title.includes('Mashle - 01'))

  console.log(`¿Aparece versión 1080p?: ${has1080 ? 'SI (CORRECTO)' : 'NO (MALO)'}`)
  console.log(`¿Aparece versión 720p?: ${has720 ? 'SI (CORRECTO)' : 'NO (MALO)'}`)
  console.log(`¿Cada versión tiene su propio torrent/hash diferente?: ${distinctHashes ? 'SI (CORRECTO)' : 'NO (MALO)'}`)
  console.log(`¿Se aisló de la Temporada 1 (no se mezclaron)?: ${noSeason1 ? 'SI (CORRECTO)' : 'NO (MALO)'}`)
}

runTests().catch(console.error)

