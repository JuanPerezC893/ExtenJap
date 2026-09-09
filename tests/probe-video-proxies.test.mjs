import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { parseProxyCandidates, testVideoRoute, findSampleVideo } from '../probe-video-proxies.mjs'

test('probe-video-proxies: parseProxyCandidates extrae proxies elite HTTPS de tabla HTML y listas de texto', () => {
  const html = `
    <table>
      <tr><td>1.2.3.4</td><td>8080</td><td>US</td><td>United States</td><td>elite proxy</td><td>no</td><td>yes</td><td>10s ago</td></tr>
      <tr><td>5.6.7.8</td><td>3128</td><td>DE</td><td>Germany</td><td>anonymous</td><td>no</td><td>yes</td><td>5s ago</td></tr>
      <tr><td>9.10.11.12</td><td>80</td><td>FR</td><td>France</td><td>elite proxy</td><td>no</td><td>no</td><td>1s ago</td></tr>
      <tr><td>999.1.1.1</td><td>8080</td><td>XX</td><td>Invalid</td><td>elite proxy</td><td>no</td><td>yes</td><td>1s ago</td></tr>
    </table>
  `
  const candidates = parseProxyCandidates(html)
  assert.deepEqual(candidates, ['http://1.2.3.4:8080'])

  const textList = "10.0.0.1:8080\n# comment\n10.0.0.2:3128\ninvalid\n"
  const textCandidates = parseProxyCandidates(textList)
  assert.deepEqual(textCandidates, ['http://10.0.0.1:8080', 'http://10.0.0.2:3128'])
})

test('probe-video-proxies: testVideoRoute valida exitosamente con Range 206 y SHA-1 correcto', async () => {
  const piece0 = Buffer.alloc(1024, 7)
  const sha1 = createHash('sha1').update(piece0).digest('hex')
  const parsed = {
    length: 1024,
    pieceLength: 1024,
    pieces: [sha1],
    files: [{ name: 'test.mkv', length: 1024 }]
  }

  const mockFetch = async (url, opts = {}) => {
    const range = opts.headers?.Range
    if (range === 'bytes=0-0') {
      return new Response(piece0.subarray(0, 1), { status: 206, headers: { 'content-range': 'bytes 0-0/1024' } })
    }
    if (range === 'bytes=0-1023') {
      return new Response(piece0, { status: 206, headers: { 'content-range': 'bytes 0-1023/1024' } })
    }
    return new Response('', { status: 404 })
  }

  const result = await testVideoRoute({
    id: 'test-direct',
    videoUrl: 'https://emision.craftervault.com/video.mkv',
    parsed,
    fetchFn: mockFetch
  })

  assert.equal(result.usable, true)
  assert.equal(result.checks.length, 2)
  assert.equal(result.checks[0].stage, 'video_byte')
  assert.equal(result.checks[0].ok, true)
  assert.equal(result.checks[1].stage, 'video_piece')
  assert.equal(result.checks[1].ok, true)
})

test('probe-video-proxies: testVideoRoute rechaza cuando video_byte devuelve 403', async () => {
  const parsed = {
    length: 1024,
    pieceLength: 1024,
    pieces: ['dummy'],
    files: [{ name: 'test.mkv', length: 1024 }]
  }

  const mockFetch = async () => new Response('', { status: 403 })

  const result = await testVideoRoute({
    id: 'test-blocked',
    videoUrl: 'https://emision.craftervault.com/video.mkv',
    parsed,
    fetchFn: mockFetch
  })

  assert.equal(result.usable, false)
  assert.equal(result.checks.length, 1)
  assert.equal(result.checks[0].stage, 'video_byte')
  assert.equal(result.checks[0].ok, false)
  assert.equal(result.checks[0].status, 403)
})

test('probe-video-proxies: testVideoRoute rechaza cuando el SHA-1 de la pieza no coincide', async () => {
  const piece0 = Buffer.alloc(1024, 1)
  const parsed = {
    length: 1024,
    pieceLength: 1024,
    pieces: ['0000000000000000000000000000000000000000'],
    files: [{ name: 'test.mkv', length: 1024 }]
  }

  const mockFetch = async (url, opts = {}) => {
    const range = opts.headers?.Range
    if (range === 'bytes=0-0') {
      return new Response(piece0.subarray(0, 1), { status: 206, headers: { 'content-range': 'bytes 0-0/1024' } })
    }
    if (range === 'bytes=0-1023') {
      return new Response(piece0, { status: 206, headers: { 'content-range': 'bytes 0-1023/1024' } })
    }
    return new Response('', { status: 404 })
  }

  const result = await testVideoRoute({
    id: 'test-sha-mismatch',
    videoUrl: 'https://emision.craftervault.com/video.mkv',
    parsed,
    fetchFn: mockFetch
  })

  assert.equal(result.usable, false)
  assert.equal(result.checks[1].stage, 'video_piece')
  assert.equal(result.checks[1].ok, false)
  assert.equal(result.checks[1].code, 'SHA1_MISMATCH')
})

test('probe-video-proxies: findSampleVideo localiza un video verificado con torrent existente', () => {
  const sample = findSampleVideo('.')
  assert.ok(sample, 'Debe encontrar una muestra en el repositorio')
  assert.ok(sample.videoUrl.startsWith('http'))
  assert.ok(fs.existsSync(sample.torrentPath))
})
