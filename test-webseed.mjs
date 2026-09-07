import extension from './dist/index.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const catalog = JSON.parse(readFileSync('./dist/indexed-catalog.json', 'utf8'))
const mockFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => catalog
})

// Mock global fetch for test()
globalThis.fetch = mockFetch

async function runTests() {
  console.log('--- Probando WebSeedSource (Japan-Paw Direct) ---')

  // Test 1: test()
  const testRes = await extension.test()
  assert.equal(testRes, true, 'test() debe devolver true')
  console.log('✔ Test 1: test() pasó correctamente')

  // Test 2: single() con coincidencia exacta por nombre y CRC32 (Sayonara Lara Ep 1 - 1080p)
  const singleQuery1 = {
    hash: '0123456789abcdef0123456789abcdef01234567',
    name: '[Erai-raws] Sayonara Lara - 01 [1080p][Multiple Subtitle]',
    file: {
      name: '[Erai-raws] Sayonara Lara - 01 [1080p CR WEB-DL AVC AAC][MultiSub][7A5D5F0E].mkv',
      index: 0
    },
    titles: ['Sayonara Lara', 'さようならララ'],
    episode: 1,
    anilistId: 186981,
    fetch: mockFetch
  }
  const res1 = await extension.single(singleQuery1)
  assert.ok(res1, 'res1 no debe ser undefined')
  assert.equal(res1.index, 0)
  assert.ok(res1.url.includes('7A5D5F0E'), 'Debe retornar la URL con CRC32 7A5D5F0E')
  console.log('✔ Test 2: single() con CRC32 exacto resuelto:', res1.url)

  // Test 3: single() con resolución 720p
  const singleQuery2 = {
    hash: 'abcdef0123456789abcdef0123456789abcdef01',
    name: '[Erai-raws] Sayonara Lara - 02 [720p][Multiple Subtitle]',
    file: {
      name: '[Erai-raws] Sayonara Lara - 02 [720p CR WEB-DL AVC AAC][MultiSub][0CC3BE3E].mkv',
      index: 1
    },
    titles: ['Sayonara Lara'],
    episode: 2,
    fetch: mockFetch
  }
  const res2 = await extension.single(singleQuery2)
  assert.ok(res2, 'res2 no debe ser undefined')
  assert.equal(res2.index, 1)
  assert.ok(res2.url.includes('0CC3BE3E'), 'Debe retornar la URL de 720p con CRC32 0CC3BE3E')
  console.log('✔ Test 3: single() 720p resuelto:', res2.url)

  // Test 4: Incompatibilidad de grupo (SubsPlease vs Erai-raws) -> no debe mezclarse para evitar error de hash
  const singleQueryMismatch = {
    hash: '1111111111111111111111111111111111111111',
    name: '[SubsPlease] Sayonara Lara - 01 (1080p) [12345678]',
    file: {
      name: '[SubsPlease] Sayonara Lara - 01 (1080p) [12345678].mkv',
      index: 0
    },
    titles: ['Sayonara Lara'],
    episode: 1,
    fetch: mockFetch
  }
  const resMismatch = await extension.single(singleQueryMismatch)
  assert.equal(resMismatch, undefined, 'No debe devolver URL para un release incompatible')
  console.log('✔ Test 4: single() incompatibilidad de grupo rechazada correctamente (evita fallo de hash WebTorrent)')

  // Test 5: batch() con archivo de video + subtítulo externo
  const batchQuery = {
    hash: '2222222222222222222222222222222222222222',
    name: '[Erai-raws] Sayonara Lara - 03 [1080p]',
    files: [
      { name: '[Erai-raws] Sayonara Lara - 03 [1080p CR WEB-DL AVC AAC][MultiSub][2A882E80].mkv', index: 0 },
      { name: 'Sayonara_Lara_03_es.srt', index: 1 }
    ],
    titles: ['Sayonara Lara'],
    episode: 3,
    fetch: mockFetch
  }
  const resBatch = await extension.batch(batchQuery)
  assert.equal(resBatch.length, 1, 'Batch debe retornar solo 1 resultado para el video')
  assert.equal(resBatch[0].index, 0)
  assert.ok(resBatch[0].url.includes('2A882E80'))
  console.log('✔ Test 5: batch() resolvió únicamente el archivo de video con índice 0:', resBatch)

  console.log('\nTodos los tests pasaron exitosamente!')
}

runTests().catch(err => {
  console.error('Error en pruebas:', err)
  process.exit(1)
})
