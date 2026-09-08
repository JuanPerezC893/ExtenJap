import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const concurrencyIdx = args.indexOf('--concurrency')
const concurrency = concurrencyIdx >= 0 && args[concurrencyIdx + 1] ? args[concurrencyIdx + 1] : '8'
const useProxy = args.includes('--proxy')

const positional = args.filter(a => !a.startsWith('--') && a !== concurrency)
const START = positional[0] ?? null
const END = positional[1] ?? null

console.log(`=== PIPELINE AUTOMÁTICO DE JAPAN-PAW ===\n`)
console.log(`Concurrencia: ${concurrency} trabajadores`)
console.log(`Proxies: ${useProxy ? 'ACTIVADOS' : 'DESACTIVADOS'}\n`)

// 1. Scraping opcional si se pasaron IDs de inicio y fin
if (START && END) {
  console.log(`1. Ejecutando scraper de pastes (IDs ${START}..${END})...`)
  execFileSync(process.execPath, ['scrape.mjs', START, END], { stdio: 'inherit' })
} else {
  console.log('1. Scraping omitido (usando raw-catalog.json existente).')
}

// 2. Indexación y Verificación estricta de piezas con WebSeed embebido
console.log('\n2. Ejecutando indexador con verificación de piezas SHA-1 HTTP...')
const indexerArgs = ['indexer.mjs', '--concurrency', concurrency]
if (useProxy) indexerArgs.push('--proxy')
execFileSync(process.execPath, indexerArgs, { stdio: 'inherit' })

// 3. Compilación y purga de catálogo dividido
console.log('\n3. Compilando catálogo dividido en dist/data/ y manifest...')
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' })

console.log('\n=== PIPELINE COMPLETADO EXITOSAMENTE ===')
