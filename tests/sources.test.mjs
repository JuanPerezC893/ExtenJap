import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCrc32, extractFansubGroup, cleanReleaseFileName, buildSearchQueries } from '../lib/sources.js'

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
