import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMetadata } from '../lib/stremio-metadata.js'
import { createAddon } from '../stremio.mjs'

test('metadata uses exact AniList IDs, shares requests and preserves playback IDs',async t=>{
 let calls=0
 const metadata=createMetadata({interval:0,fetchFn:async(u,o)=>{calls++;assert.deepEqual(JSON.parse(o.body).variables.ids,[185660]);return Response.json({data:{Page:{media:[{id:185660,coverImage:{large:'https://example.com/cover.jpg'},bannerImage:'https://example.com/banner.jpg',description:'A <b>story</b>',genres:['Action'],startDate:{year:2025}}]}}})}})
 const catalog=[{sourceV:7394,anilistId:185660,title:'Dandadan 2nd Season',episodes:[{episode:1,url:'https://anime.craftervault.com/test.mkv'}]}]
 const app=await createAddon({catalog,metadata,port:0,fetchFn:async()=>{throw Error('No video request expected')}});t.after(()=>app.close())
 const [a,b]=await Promise.all([fetch(app.base+'/catalog/series/japanpaw.json').then(r=>r.json()),fetch(app.base+'/meta/series/jp:7394.json').then(r=>r.json())])
 assert.equal(calls,1);assert.equal(a.metas[0].poster,'https://example.com/cover.jpg');assert.equal(b.meta.description,'A story');assert.equal(b.meta.videos[0].id,'jp:7394:1:1')
})

test('metadata failure backs off and does not remove catalog entries',async()=>{
 let calls=0;const m=createMetadata({log:()=>{},fetchFn:async()=>{calls++;return new Response(null,{status:429,headers:{'retry-after':'120'}})}})
 await m.ensure([{anilistId:1}]);await m.ensure([{anilistId:1}]);assert.equal(calls,1);assert.deepEqual(m.get(1),{})
})

test('metadata resolves offline from offline database by anilistId and title without network', async () => {
  const tmpFile = join(tmpdir(), `offline-test-${Date.now()}.json`)
  writeFileSync(tmpFile, JSON.stringify({
    data: [{
      sources: ['https://anilist.co/anime/77777'],
      title: 'Offline Hero Test',
      picture: 'https://cdn.example.com/offline77777.jpg',
      tags: ['Action', 'Fantasy'],
      animeSeason: { year: 2024 },
      duration: { value: 1500, unit: 'SECONDS' }
    }]
  }))
  try {
    const m = createMetadata({
      offlineDbPath: tmpFile,
      fetchFn: async () => { throw new Error('No network should be used') }
    })
    await m.ensure([{ anilistId: 77777, title: 'Offline Hero Test' }, { title: 'Offline Hero Test' }])
    const byId = m.get(77777)
    assert.equal(byId.poster, 'https://cdn.example.com/offline77777.jpg')
    assert.equal(byId.releaseInfo, '2024')
    assert.equal(byId.runtime, '25 min')
    assert.deepEqual(byId.genres, ['Action', 'Fantasy'])
    const byTitle = m.get(undefined, 'Offline Hero Test')
    assert.equal(byTitle.poster, 'https://cdn.example.com/offline77777.jpg')
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
})

