// Decode a local H264/AAC fixture using real hls.js; no catalog or provider is contacted.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CALAMAR_PLAYWRIGHT || 'playwright');
const hls=await readFile(process.env.CALAMAR_HLS || require.resolve('hls.js/dist/hls.min.js'));
const segment=await readFile('app/src/androidTest/assets/live.ts');
const root=resolve('web');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/test.html') {res.setHeader('Content-Type','text/html');res.end(`<video id="video" muted autoplay playsinline></video><script src="/hls.js"></script><script type="module">
    import {mountRenewable} from '/renewable-player.js';
    window.stopPlayer=mountRenewable({page:new URLSearchParams(location.search).get('page') || 'https://zicotv.cc/api/player/1',video:document.querySelector('video'),Hls,
      onStatus:s=>window.statusText=s});
    window.started=true;
    </script>`);return;}
  if(path==='/hls.js') {res.setHeader('Content-Type','text/javascript');res.end(hls);return;}
  const file=resolve(root,'.'+path);
  if(!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try {res.setHeader('Content-Type','text/javascript');res.end(await readFile(file));}
  catch {res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
const provider='https://zicotv.cc/api/player/1', channel='https://bp.zicotv.cc/channels/1';
const relay='https://www.calamarmenciano.com/calamar-player.php';
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.CALAMAR_CHROME_CHANNEL?{channel:process.env.CALAMAR_CHROME_CHANNEL}:{})});
  for(const [entry,hosted] of [[provider,false],[channel,false],[channel,true]]) {
    const page=await browser.newPage();const requests=[],errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=route.request().url(),u=new URL(url);
      if(url.startsWith(base))return route.continue();
      requests.push(url);
      const headers={'access-control-allow-origin':'*'};
      if(url===provider || url==='https://bp.zicotv.cc/api/player/1') {
        if(hosted)return route.abort('connectionreset');
        return route.fulfill({headers,body:'var ZT_SOURCES = '+JSON.stringify([{url:'https://cdn.example/manifest.m3u8'}])+';'});
      }
      if(u.hostname==='calamarmenciano.com')return route.abort('connectionreset');
      if(u.hostname!=='www.calamarmenciano.com' && u.hostname!=='cdn.example')throw Error('Unexpected destination '+u.hostname);
      if(u.searchParams.has('page'))return route.fulfill({headers,contentType:'application/json',body:JSON.stringify({url:'calamar-player.php?seg=master&sig=ok'})});
      const key=u.searchParams.get('seg') || u.pathname.split('/').pop();
      if(hosted)await new Promise(ok=>setTimeout(ok,10000));
      const next=name=>hosted?'calamar-player.php?seg='+name+'&sig=ok':name+'.m3u8';
      if(['master','manifest.m3u8'].includes(key))return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="avc1.42c00b,mp4a.40.2"\n'+next('media')+'\n'});
      if(['media','media.m3u8'].includes(key))return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:9\n'+Array.from({length:4},(_,i)=>(i?'#EXT-X-DISCONTINUITY\n':'')+'#EXTINF:8.023,\n'+(hosted?'calamar-player.php?seg=video&sig=ok&n='+i:'video.ts?n='+i)+'\n').join('')+'#EXT-X-ENDLIST\n'});
      if(key==='video'||key==='video.ts')return route.fulfill({headers,contentType:'video/mp2t',body:segment});
      throw Error('Unexpected media request '+key);
    });
    await page.goto(base+'/test.html?page='+encodeURIComponent(entry));
    await page.waitForFunction(()=>window.started);
    await page.locator('video').evaluate(v=>{v.muted=true;void v.play();});
    await page.waitForFunction(()=>{const v=document.querySelector('video');return v.videoWidth>0&&v.currentTime>.3&&!v.paused;},null,{timeout:55000});
    assert.deepEqual(errors,[]);
    if(hosted) {
      assert.equal(requests.filter(u=>new URL(u).searchParams.has('page')).length,2,'Valid slow startup must not restart metadata lookup');
      assert.ok(requests.filter(u=>new URL(u).searchParams.has('seg')).every(u=>u.startsWith(relay)));
    } else assert.ok(requests.every(u=>u===provider||u==='https://bp.zicotv.cc/api/player/1'||new URL(u).hostname==='cdn.example'));
    assert.ok(!requests.includes(channel), 'Never open the channel detail page or its premium redirect');
    assert.equal(await page.locator('iframe').count(),0);
    console.log(hosted?'PASS: provider/root reset, www relay and slow master/media/fragment render real video':'PASS: existing direct web route renders real video');
    await page.evaluate(()=>window.stopPlayer());await page.close();
  }
} finally {await browser?.close();await new Promise(ok=>server.close(ok));}
