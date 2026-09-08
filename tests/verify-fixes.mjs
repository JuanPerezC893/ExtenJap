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
}

runTests().catch(console.error)

