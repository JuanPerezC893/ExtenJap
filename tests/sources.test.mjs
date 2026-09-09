import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCrc32, extractFansubGroup, cleanReleaseFileName, buildSearchQueries, parseNyaaResults, parseAnimeToshoResults, parseAniSearchResults, parseNekoBTResults, searchNyaa, searchAnimeTosho, searchAniSearch, searchNekoBT } from '../lib/sources.js'
import { createIndexerNetwork } from '../lib/indexer-network.js'

test('sources: extractCrc32 extrae hash de 8 caracteres en mayúsculas', () => {
  assert.equal(extractCrc32('[Erai-raws] Mashle - 01 [1080p][DF020541].mkv'), 'DF020541')
  assert.equal(extractCrc32('Sayonara Lara [7a5d5f0e]'), '7A5D5F0E')
  assert.equal(extractCrc32('Archivo sin crc.mkv'), null)
})

test('sources: extractFansubGroup extrae el fansub del inicio', () => {
  assert.equal(extractFansubGroup('[Erai-raws] Mashle - 01.mkv'), 'Erai-raws')
  assert.equal(extractFansubGroup('[xDaiyoukai] Taboo Tattoo.mkv'), 'xDaiyoukai')
  assert.equal(extractFansubGroup('[ToonsHub] Barbaroi.mkv'), 'ToonsHub')
  assert.equal(extractFansubGroup('[1080p] Archivo.mkv'), null)
  assert.equal(extractFansubGroup('[Japan-Paw] Archivo.mkv'), null)
})

test('sources: cleanReleaseFileName remueve marcas de Japan-Paw y extensiones', () => {
  const dirty = '[xDaiyoukai] Taboo Tattoo 01 [BD1080p] (Japan-Paw.net).mkv'
  const clean = cleanReleaseFileName(dirty)
  assert.equal(clean, '[xDaiyoukai] Taboo Tattoo 01 [BD1080p]')
})

test('sources: buildSearchQueries genera consultas ordenadas por prioridad (CRC primero, luego grupo, luego alias)', () => {
  const series = {
    title: 'Hime Kishi wa Barbaroi no Yome',
    aliases: ['The Warrior Princess and the Barbaric King']
  }
  const ep = {
    episode: 1,
    resolution: '1080',
    fileName: '[ToonsHub] The Warrior Princess 01 [1234ABCD].mkv'
  }

  const queries = buildSearchQueries(series, ep)
  assert.ok(queries.length >= 3)
  assert.equal(queries[0].query, '1234ABCD', 'La primera consulta debe ser el CRC32')
  assert.ok(queries.some(q => q.query.includes('The Warrior Princess and the Barbaric King')), 'Debe incluir alias de AniList')
})

test('sources: Nyaa distingue resultados, tabla vacía y páginas de bloqueo con HTTP 200', () => {
  const html = `<html><table class="table torrent-list"><tbody><tr>
    <td><a title="comments" href="/view/42#comments">2</a>
    <a title='[Group] A &amp; B &#x26; C &quot;01&quot;.mkv' class='name' href='/view/42'>Short title</a></td>
    <td><a href="/download/42.torrent">download</a></td>
    </tr></tbody></table></html>`
  assert.deepEqual(parseNyaaResults(html), [{ title: '[Group] A & B & C "01".mkv', torrent_url: 'https://nyaa.si/download/42.torrent', source: 'nyaa' }])
  assert.deepEqual(parseNyaaResults('<table class="torrent-list"><tbody></tbody></table>'), [])
  assert.throws(() => parseNyaaResults('<html><title>Just a moment...</title>Checking your browser</html>'), { code: 'INVALID_RESPONSE' })
  assert.throws(() => parseNyaaResults('<table class="torrent-list"><tr><td><a href="/download/42.torrent">download</a></td></tr></table>'), { code: 'INVALID_RESPONSE' })
})

test('sources: AnimeTosho admite listas vacías y rechaza JSON con otro esquema', () => {
  assert.deepEqual(parseAnimeToshoResults([]), [])
  assert.equal(parseAnimeToshoResults([{ torrent_name: 'Release', torrent_url: 'https://example.test/file.torrent' }])[0].title, 'Release')
  assert.throws(() => parseAnimeToshoResults({ error: 'rate limited' }), { code: 'INVALID_RESPONSE' })
  assert.throws(() => parseAnimeToshoResults([{}]), { code: 'INVALID_RESPONSE' })
})

test('sources: AniSearch parsea resultados, convierte URLs de view a download y rechaza JSON inválido', () => {
  assert.deepEqual(parseAniSearchResults([]), [])
  const parsed = parseAniSearchResults([{
    torrentName: 'Release 01',
    torrentFileUrl: 'https://nyaa.si/view/12345/torrent',
    infohash: 'abcd1234',
    length: 1000000
  }])
  assert.equal(parsed[0].title, 'Release 01')
  assert.equal(parsed[0].torrent_url, 'https://nyaa.si/download/12345.torrent')
  assert.equal(parsed[0].info_hash, 'abcd1234')
  assert.equal(parsed[0].total_size, 1000000)
  assert.equal(parsed[0].source, 'anisearch')
  assert.throws(() => parseAniSearchResults({ error: 'fail' }), { code: 'INVALID_RESPONSE' })
  assert.throws(() => parseAniSearchResults([{}]), { code: 'INVALID_RESPONSE' })
})

test('sources: NekoBT parsea resultados, construye link de descarga por ID y rechaza JSON inválido', () => {
  assert.deepEqual(parseNekoBTResults({ data: { results: [] } }), [])
  const parsed = parseNekoBTResults({
    data: {
      results: [{
        id: '998877',
        title: 'Neko Release',
        infohash: 'ef012345',
        filesize: '500000'
      }]
    }
  })
  assert.equal(parsed[0].title, 'Neko Release')
  assert.equal(parsed[0].torrent_url, 'https://nekobt.to/api/v1/torrents/998877/download?public=true')
  assert.equal(parsed[0].info_hash, 'ef012345')
  assert.equal(parsed[0].total_size, 500000)
  assert.equal(parsed[0].source, 'nekobt')
  assert.throws(() => parseNekoBTResults({ invalid: true }), { code: 'INVALID_RESPONSE' })
  assert.throws(() => parseNekoBTResults({ data: { results: [{}] } }), { code: 'INVALID_RESPONSE' })
})

test('sources: búsquedas fallidas no se convierten en resultados vacíos ni se reintentan por trabajador', async () => {
  for (const search of [searchNyaa, searchAnimeTosho, searchAniSearch, searchNekoBT]) {
    let calls = 0
    await assert.rejects(search('crc', async () => { calls++; return new Response('slow down', { status: 429, headers: { 'Retry-After': '60' } }) }, 5), { code: 'RATE_LIMITED', status: 429 })
    assert.equal(calls, 1)
    await assert.rejects(search('crc', async () => { throw new TypeError('offline') }), { code: 'NETWORK_ERROR' })
    await assert.rejects(search('crc', async () => new Response('<html>challenge</html>')), { code: 'INVALID_RESPONSE' })
  }
})

test('sources: todas las búsquedas comparten el cooldown y propagan cancelación', async () => {
  let calls = 0
  const network = createIndexerNetwork({ minIntervalMs: 0, fetchFn: async () => { calls++; return new Response('', { status: 429 }) } })
  await assert.rejects(searchNyaa('one', network.fetch), { code: 'RATE_LIMITED' })
  await assert.rejects(searchNyaa('two', network.fetch), { code: 'HOST_COOLDOWN' })
  assert.equal(calls, 1)
  const abort = new AbortController()
  abort.abort()
  await assert.rejects(searchAnimeTosho('query', network.fetch, { signal: abort.signal }), { code: 'ABORTED' })
  assert.equal(calls, 1)
})
