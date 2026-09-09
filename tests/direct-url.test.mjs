import test from 'node:test'
import assert from 'node:assert/strict'
import { directUrl } from '../lib/direct-url.js'

test('direct URL preserves encoded path and signed query', () => {
  const url = 'https://anime.craftervault.com/0:down/A%2FB/video.mkv?signature=ABC%2Fxyz%2B123&expires=123'
  assert.equal(directUrl(url), url)
  assert.equal(directUrl(' https://anime.craftervault.com/My Video.mkv '), 'https://anime.craftervault.com/My%20Video.mkv')
})

test('ouo wrapper extracts only the explicit s parameter', () => {
  const target = 'https://anime.craftervault.com/A%2FB/video.mkv?key=abc%2Fdef&expiry=123'
  assert.equal(directUrl('https://ouo.io/qs/example?s=' + encodeURIComponent(target)), target)
  assert.equal(directUrl('https://ouo.io/qs/example?s=' + encodeURIComponent(encodeURIComponent(target))), target)
  assert.equal(directUrl('https://ouo.io/example'), null)
  assert.equal(directUrl('https://ouo.io/example?url=' + encodeURIComponent(target)), null)
})

test('Japan-Paw fragment wrapper handles raw and encoded targets', () => {
  const target = 'https://emision.craftervault.com/0:down/Title/[Group] Episode - 01.mkv'
  const expected = new URL(target).href
  assert.equal(directUrl('https://redirect.japan-paw.net/#' + target), expected)
  assert.equal(directUrl('https://redirect.japan-paw.net/#' + encodeURIComponent(target)), expected)
  assert.equal(directUrl('https://redirect.japan-paw.net/'), null)
})

test('nested known wrappers are bounded and preserve the final URL', () => {
  const target = 'https://anime.craftervault.com/video.mkv'
  const inner = 'https://redirect.japan-paw.net/#' + encodeURIComponent(target)
  assert.equal(directUrl('https://ouo.io/qs/x?s=' + encodeURIComponent(inner)), target)
  let many = target
  for (let i = 0; i < 9; i++) many = 'https://redirect.japan-paw.net/#' + encodeURIComponent(many)
  assert.equal(directUrl(many), null)
})

test('rejects invalid or non-HTTP targets without resolving arbitrary hosts', () => {
  for (const value of [null, undefined, '', 'not a url', 'file:///video.mkv', 'javascript:alert(1)',
    'https://redirect.japan-paw.net/#javascript:alert(1)', 'https://ouo.io/?s=%ZZ']) {
    assert.equal(directUrl(value), null)
  }
  const otherHost = 'https://example.com/redirect?s=https%3A%2F%2Fanime.craftervault.com%2Fvideo.mkv'
  assert.equal(directUrl(otherHost), otherHost)
  const lookalike = 'https://redirect.japan-paw.net.example.com/#https://anime.craftervault.com/video.mkv'
  assert.equal(directUrl(lookalike), lookalike)
})
