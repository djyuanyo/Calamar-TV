// Four real H264/AAC decoders through isolated, signed hosting fixtures. No live catalog access.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), {chromium}=require(process.env.CALAMAR_PLAYWRIGHT||'playwright');
const hls=await readFile(process.env.CALAMAR_HLS||require.resolve('hls.js/dist/hls.min.js'));
const segment=await readFile('app/src/androidTest/assets/live.ts'), root=resolve('web');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/test.html'){res.setHeader('Content-Type','text/html');res.end(`<link rel="stylesheet" href="/styles.css"><button id="begin">Empezar</button><script src="/hls.js"></script><script type="module">
    import {openMulti,closeMulti} from '/multi-view.js';
    const entries=Array.from({length:5},(_,i)=>({id:'tile-'+i,name:'Ventana '+(i+1),playable:true,streams:['https://zicotv.cc/api/player/'+(i+1)]}));
    document.querySelector('#begin').onclick=()=>{window.testMulti=openMulti(entries.slice(0,2));};
    window.addTestTile=i=>window.testMulti.add(entries[i]);window.stopTest=closeMulti;window.ready=true;
  </script>`);return;}
  if(path==='/hls.js'){res.setHeader('Content-Type','text/javascript');res.end(hls);return;}
  const file=resolve(root,'.'+path);if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',path.endsWith('.css')?'text/css':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CALAMAR_CHROME_CHANNEL?{channel:process.env.CALAMAR_CHROME_CHANNEL}:{})});
  const page=await browser.newPage(), errors=[],lookups=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const u=new URL(route.request().url());if(u.origin===base)return route.continue();
    if(u.hostname==='zicotv.cc')return route.abort('connectionreset');
    assert.equal(u.hostname,'calamarmenciano.com');const headers={'access-control-allow-origin':'*'};
    if(u.searchParams.has('page')){lookups.push(u.searchParams.get('page'));return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({url:'calamar-player.php?seg=media&sig=ok&id='+new URL(u.searchParams.get('page')).pathname.split('/').pop()})});}
    if(u.searchParams.get('seg')==='media')return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:9\n'+Array.from({length:8},(_,i)=>(i?'#EXT-X-DISCONTINUITY\n':'')+'#EXTINF:8.023,\ncalamar-player.php?seg=video&sig=ok&n='+i+'\n').join('')+'#EXT-X-ENDLIST\n'});
    return route.fulfill({headers,contentType:'video/mp2t',body:segment});
  });
  await page.goto(base+'/test.html');await page.waitForFunction(()=>window.ready);await page.locator('#begin').click();
  const renders=async count=>page.waitForFunction(n=>{const videos=[...document.querySelectorAll('.multi video')];return videos.length===n&&videos.every(v=>v.videoWidth>0&&v.currentTime>.3&&!v.paused);},count,{timeout:30000});
  await renders(2);
  await page.locator('.multi video').first().evaluate(v=>v.dataset.retained='yes');
  await page.evaluate(()=>window.addTestTile(2));await renders(3);
  await page.evaluate(()=>window.addTestTile(3));await renders(4);
  assert.equal(await page.locator('.multi video').first().getAttribute('data-retained'),'yes');
  assert.deepEqual(await page.locator('.multi video').evaluateAll(v=>v.map(x=>x.muted)),[false,true,true,true]);
  assert.equal(await page.evaluate(()=>window.addTestTile(4)),false);assert.equal(await page.locator('.multi video').count(),4);
  assert.equal(lookups.length,4,'Adding tiles must not re-resolve earlier players');assert.deepEqual(errors,[]);
  await page.evaluate(()=>window.stopTest());assert.equal(await page.locator('.multi').count(),0);
  console.log('PASS: two, three and four real H264/AAC videos through signed hosting; first video retained; one audio track; fifth tile rejected');
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
