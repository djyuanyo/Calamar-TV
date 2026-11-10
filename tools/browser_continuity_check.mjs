import {fakeFirebase} from './browser_fixture.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.CALAMAR_PLAYWRIGHT||'playwright');
const hls=await readFile(process.env.CALAMAR_HLS||require.resolve('hls.js/dist/hls.min.js'));
const video=await readFile('app/src/androidTest/assets/live.ts'),root=resolve('web');
const fixture={channels:[{id:'continuous',name:'Continuidad',group:'Deportes',streams:['https://bp.zicotv.cc/api/player/1']}],events:[],leagues:[],teams:[],featured:[],hidden:[]};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/firebase.js'){res.setHeader('Content-Type','text/javascript');res.end(fakeFirebase(fixture));return;}
  if(path.startsWith('/data/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(path.includes('custom')?fixture:{channels:[]}));return;}
  try{const file=resolve(root,'.'+(path==='/'?'/index.html':path));if(!file.startsWith(root+'/'))throw Error();
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));
  }catch{res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base=`http://127.0.0.1:${server.address().port}`;
const signed=(path,n)=>'https://calamarmenciano.com/calamar-player.php?seg='+Buffer.from(`https://cdn.example/${path}?token=v${n}`).toString('base64url')+'&sig=v'+n;
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.CALAMAR_CHROME_CHANNEL?{channel:process.env.CALAMAR_CHROME_CHANNEL}:{})});
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    const later=window.setTimeout.bind(window);let renewals=0;
    window.setTimeout=(callback,delay,...args)=>later(callback,delay===300000&&new Error().stack.includes('renewable-player.js')&&renewals++===0?1500:delay,...args);
    window.__engines=0;window.__destroyed=0;
  });
  // The Zico route now prefers the hosting; direct playback is exercised by browser_hosting_check.
  for(const hosted of [true]){
    let generation=0,freshMedia=0;const errors=[];
    await page.unroute('**/*');
    await page.route('**/*',async route=>{
      const u=new URL(route.request().url()),headers={'access-control-allow-origin':'*'};
      if(u.origin===base)return route.continue();
      if(u.hostname==='cdn.jsdelivr.net'&&u.pathname.includes('/hls.js@'))return route.fulfill({contentType:'text/javascript',body:hls.toString()+'\nwindow.Hls=class extends window.Hls{constructor(c){super(c);window.__engines++;}destroy(){window.__destroyed++;super.destroy();}};'});
      if(u.hostname==='bp.zicotv.cc'){
        if(hosted)return route.abort();
        generation++;return route.fulfill({headers,body:'var ZT_SOURCES='+JSON.stringify([{url:`https://cdn.example/index.m3u8?token=v${generation}`}])+';'});
      }
      if(u.hostname==='calamarmenciano.com'&&u.searchParams.has('page')){
        if(u.searchParams.has('list'))return route.fulfill({headers,json:{sources:1}});
        generation++;return route.fulfill({headers,json:{url:signed('index.m3u8',generation)}});
      }
      let origin=u;
      if(u.hostname==='calamarmenciano.com'&&u.searchParams.has('seg'))origin=new URL(Buffer.from(u.searchParams.get('seg'),'base64url').toString());
      if(origin.hostname!=='cdn.example')return route.abort();
      const n=Number(origin.searchParams.get('token')?.slice(1)||1);
      if(origin.pathname==='/index.m3u8')return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=300000,CODECS="avc1.42c00b,mp4a.40.2"\n'+(hosted?signed('media.m3u8',n):`https://cdn.example/media.m3u8?token=v${n}`)+'\n'});
      if(origin.pathname==='/media.m3u8'){
        if(n<generation)return route.fulfill({headers,status:403,body:'Expired'});
        if(n>=2)freshMedia++;
        return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:9\n'+Array.from({length:3},(_,i)=>(i?'#EXT-X-DISCONTINUITY\n':'')+'#EXTINF:8.023,\n'+(hosted?signed('video.ts',n):`https://cdn.example/video.ts?token=v${n}`)+'&n='+i+'\n').join('')});
      }
      if(origin.pathname==='/video.ts')return route.fulfill({headers,contentType:'video/mp2t',body:video});
      return route.abort();
    });
    const onError=e=>errors.push(e.message);page.on('pageerror',onError);
    await page.goto(base+'/?mode='+hosted+'#/canales');
    await page.locator('.card').filter({hasText:'Continuidad'}).click();
    await page.waitForFunction(()=>document.querySelector('#video')?.currentTime>.3,null,{timeout:20000});
    const before=await page.locator('#video').evaluate(v=>v.currentTime);
    const deadline=Date.now()+20000;
    while((generation<2||freshMedia===0)&&Date.now()<deadline)await page.waitForTimeout(100);
    await page.waitForFunction(before=>window.__engines===1&&document.querySelector('#video')?.currentTime>before+1,before,{timeout:12000});
    assert.ok(generation>=2,'The scheduled renewal did not run');
    assert.ok(freshMedia>0,'The unchanged decoder never requested the fresh media playlist');
    assert.equal(await page.evaluate(()=>window.__destroyed),0);
    assert.ok(await page.locator('#video').evaluate(v=>v.currentTime)>before+1);
    assert.deepEqual(errors,[]);page.off('pageerror',onError);
    console.log('PASS: '+(hosted?'hosted':'direct')+' live token rotation uses fresh child playlists with the same decoder and advancing playback');
  }
}finally{await browser?.close();await new Promise(ok=>server.close(ok));}
