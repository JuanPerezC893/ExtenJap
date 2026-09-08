import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('bundled worker modules load without TorrentSource globals or external imports', async t => {
  const previousSelf = globalThis.self
  globalThis.self = globalThis
  t.after(() => { if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf })

  const code = fs.readFileSync('dist/torrent.js', 'utf8')
  const module = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))

  const mockData = {
    anilistId: 100,
    title: 'Demo Show',
    episodes: [
      {
        episode: 1,
        resolution: '1080',
        fileName: 'Demo - 01 [1080p].mkv',
        size: 500,
        hash: 'e'.repeat(40),
        torrent: 'torrents/' + 'e'.repeat(40) + '.torrent'
      }
    ]
  }

  const fetch = async url => {
    if (url.includes('data/100.json')) return Response.json(mockData)
    return new Response('404', { status: 404 })
  }

  const result = await module.createTorrentSource().single({ anilistId: 100, episode: 1, fetch })
  assert.equal(result.length, 1)
  assert.equal(result[0].hash, 'e'.repeat(40))
  assert.equal(result[0].accuracy, 'high')
  assert.match(result[0].title, /\[DDL verificado\]/)
})
