import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const START = process.argv[2] ?? '7890'
const END = process.argv[3] ?? '7910'

console.log(`=== PIPELINE AUTOMÁTICO DE JAPAN-PAW (IDs ${START}..${END}) ===\n`)

// 1. Scraping
console.log('1. Ejecutando scraper de pastes...')
execFileSync(process.execPath, ['scrape.mjs', START, END], { stdio: 'inherit' })

// 2. Vinculación por CRC32
console.log('\n2. Vinculando torrents oficiales por CRC32...')
execFileSync(process.execPath, ['link-by-crc.mjs'], { stdio: 'inherit' })

// 3. Vinculación por Título / Fansub para los que no tengan CRC32
console.log('\n3. Vinculando torrents restantes por título...')
execFileSync(process.execPath, ['link-torrents.mjs'], { stdio: 'inherit' })

// 4. Compilar distribución
console.log('\n4. Compilando distribución para GitHub...')
execFileSync(process.execPath, ['build.mjs', 'https://raw.githubusercontent.com/JuanPerezC893/ExtenJap/main/dist/'], { stdio: 'inherit' })

console.log('\n=== PIPELINE COMPLETADO EXITOSAMENTE ===')
