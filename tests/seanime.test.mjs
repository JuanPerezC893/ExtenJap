import test from 'node:test'
import assert from 'node:assert/strict'
import { createAddon } from '../stremio.mjs'

const catalog = [
  {
    sourceV: 1,
    anilistId: 185874,
    title: 'BLEACH: Sennen Kessen-hen - Kashin-tan',
    aliases: ['Bleach TYBW Part 4'],
    episodes: [
      { episode: 1, resolution: '1080', url: 'https://anime.craftervault.com/bleach_1080.mkv', fileName: 'bleach_1080.mkv' },
      { episode: 1, resolution: '720', url: 'https://anime.craftervault.com/bleach_720.mkv', fileName: 'bleach_720.mkv' }
    ]
  }
]

test('Seanime endpoints: manifest, provider, search, episodes and sources', async t => {
  const app = await createAddon({ catalog, port: 0, log: () => {}, fetchFn: async () => { throw new Error('No video request expected') } })
  t.after(() => app.close())

  const get = async path => (await fetch(app.base + path)).json()

  // 1. Manifest
  const manifest = await get('/seanime/manifest.json')
  assert.equal(manifest.id, 'japanpaw-direct')
  assert.equal(manifest.type, 'onlinestream-provider')
  assert.equal(manifest.payloadURI, app.base + '/seanime/provider.js')

  // 2. Provider code
  const providerRes = await fetch(app.base + '/seanime/provider.js')
  assert.equal(providerRes.status, 200)
  const providerCode = await providerRes.text()
  assert.match(providerCode, /class Provider/)

  // 3. Search by text
  const searchByText = await get('/seanime/search?q=Bleach')
  assert.equal(searchByText.results.length, 1)
  assert.equal(searchByText.results[0].title, 'BLEACH: Sennen Kessen-hen - Kashin-tan')
  assert.equal(searchByText.results[0].id, 'jp:1')

  // 4. Search by anilistId
  const searchById = await get('/seanime/search?anilistId=185874')
  assert.equal(searchById.results.length, 1)
  assert.equal(searchById.results[0].id, 'jp:1')

  // 5. Episodes
  const epData = await get('/seanime/episodes?id=jp:1')
  assert.equal(epData.episodes.length, 1)
  assert.equal(epData.episodes[0].number, 1)
  assert.equal(epData.episodes[0].id, 'jp:1:1')

  // 6. Source default / 1080p
  const source1080 = await get('/seanime/source?id=jp:1:1&server=Japan-Paw%201080p')
  assert.equal(source1080.videoSources.length, 2)
  assert.equal(source1080.videoSources[0].quality, '1080p')
  assert.match(source1080.videoSources[0].url, new RegExp('^' + app.base + '/play/'))

  // 7. Source 720p priority
  const source720 = await get('/seanime/source?id=jp:1:1&server=Japan-Paw%20720p')
  assert.equal(source720.videoSources[0].quality, '720p')
})
