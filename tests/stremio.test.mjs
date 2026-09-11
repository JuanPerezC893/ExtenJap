import test from 'node:test'
import assert from 'node:assert/strict'
import { createAddon } from '../stremio.mjs'
const catalog = [{sourceV:1,title:'Demo',aliases:['Prueba'],episodes:[{episode:1,resolution:'1080',url:'https://anime.craftervault.com/test.mkv',fileName:'test.mkv'},{episode:1,resolution:'720',url:'https://anime.craftervault.com/test720.mkv'}]}]
test('Stremio catalog, search, episode variants and byte ranges require no torrent', async t => {
  let calls=0
  const app=await createAddon({catalog,port:0,log:()=>{},fetchFn:async (url,opts)=>{calls++;assert.equal(opts.headers.Range,'bytes=4-7');return new Response(Buffer.from('4567'),{status:206,headers:{'content-type':'video/x-matroska','content-range':'bytes 4-7/10','content-length':'4'}})}})
  t.after(()=>app.close())
  const get=async path=>(await fetch(app.base+path)).json()
  assert.equal((await get('/manifest.json')).id,'local.japanpaw.http')
  assert.equal((await get('/catalog/series/japanpaw/search=Prueba.json')).metas.length,1)
  assert.equal((await get('/catalog/series/japanpaw/skip=100.json')).metas.length,0)
  const meta=(await get('/meta/series/jp:1.json')).meta
  assert.equal(meta.videos.length,1)
  const streams=(await get(`/stream/series/${meta.videos[0].id}.json`)).streams
  assert.equal(streams.length,2); assert.equal(calls,0)
  const response=await fetch(streams[0].url,{headers:{Range:'bytes=4-7'}})
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 4-7/10');assert.equal(await response.text(),'4567')
  assert.equal((await fetch(app.base+'/play/https://example.com')).status,404)
})
test('Stremio rejects HTML masquerading as video and off-host redirects',async t=>{
  for(const response of [()=>new Response('<html>blocked</html>',{headers:{'content-type':'text/html'}}),()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})]) {
    const app=await createAddon({catalog,port:0,log:()=>{},fetchFn:async()=>response()});t.after(()=>app.close())
    const {streams}=await (await fetch(app.base+'/stream/series/jp:1:1:1.json')).json()
    assert.equal((await fetch(streams[0].url)).status,502)
  }
})
test('Stremio preserves HEAD and unsatisfiable range responses',async t=>{
  const app=await createAddon({catalog,port:0,log:()=>{},fetchFn:async(u,o)=>new Response(null,{status:o.method==='HEAD'?200:416,headers:o.method==='HEAD'?{'content-length':'100','content-type':'video/mp4'}:{'content-range':'bytes */100'}})});t.after(()=>app.close())
  const {streams}=await (await fetch(app.base+'/stream/series/jp:1:1:1.json')).json()
  const head=await fetch(streams[0].url,{method:'HEAD'});assert.equal(head.headers.get('content-length'),'100');assert.equal(await head.text(),'')
  const bad=await fetch(streams[0].url,{headers:{Range:'bytes=101-'}});assert.equal(bad.status,416);assert.equal(bad.headers.get('content-range'),'bytes */100')
})

test('Stremio refuses ignored ranges instead of transferring the full video',async t=>{
  const app=await createAddon({catalog,port:0,log:()=>{},fetchFn:async()=>new Response('entire file',{headers:{'content-type':'video/mp4'}})});t.after(()=>app.close())
  const {streams}=await(await fetch(app.base+'/stream/series/jp:1:1:1.json')).json()
  assert.equal((await fetch(streams[0].url,{headers:{Range:'bytes=4-7'}})).status,502)
})
