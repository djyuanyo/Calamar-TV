// Paste a channel page in the real admin, save it, then open its card in our own player.
import { fakeFirebase } from './browser_fixture.mjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CALAMAR_PLAYWRIGHT || 'playwright');
const root = resolve('web'), fixture = {channels:[],featured:[],hidden:[],events:[],leagues:[],teams:[]};
const hls = await readFile(process.env.CALAMAR_HLS || require.resolve('hls.js/dist/hls.min.js'));
const segment = await readFile('app/src/androidTest/assets/live.ts');
const server = createServer(async (req,res) => {
  const path = new URL(req.url,'http://localhost').pathname;
  if (path === '/firebase.js') {res.setHeader('Content-Type','text/javascript');res.end(fakeFirebase(fixture));return;}
  if (path.startsWith('/data/')) {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(path.includes('custom')?fixture:{channels:[]}));return;}
  try {
    const file = resolve(root,'.'+(path==='/'?'/index.html':path));
    if (!file.startsWith(root+'/')) throw Error();
    res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  } catch {res.writeHead(404).end();}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.CALAMAR_CHROME_CHANNEL?{channel:process.env.CALAMAR_CHROME_CHANNEL}:{})});
  const page = await browser.newPage({viewport:{width:390,height:844}}), requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=> {
    const u = new URL(route.request().url());
    if (u.origin===base) return route.continue();
    requests.push(u.href);
    const headers={'access-control-allow-origin':'*'};
    if (u.hostname==='cdn.jsdelivr.net' && u.pathname.includes('/hls.js@')) return route.fulfill({contentType:'text/javascript',body:hls});
    if (u.hostname==='bp.zicotv.cc') return route.abort(); // Simulate the operator blocking direct requests.
    if (u.hostname!=='calamarmenciano.com') return route.abort();
    if (u.searchParams.has('page')) {
      assert.equal(u.searchParams.get('page'),'https://bp.zicotv.cc/api/player/1');
      return route.fulfill({headers,json:u.searchParams.has('list')?{items:[{id:'0123456789abcdef',name:'Prueba · Señal 1'}]}:{url:'calamar-player.php?seg=master&sig=ok'}});
    }
    if (u.searchParams.get('seg')==='master') return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-TARGETDURATION:9\n#EXTINF:8.023,\ncalamar-player.php?seg=video&sig=ok\n#EXT-X-ENDLIST\n'});
    if (u.searchParams.get('seg')==='video') return route.fulfill({headers,contentType:'video/mp2t',body:segment});
    return route.abort();
  });
  await page.goto(base+'/#/admin/nuevo');
  await page.getByLabel('Nombre',{exact:true}).fill('Prueba Zico');
  await page.getByLabel('Enlaces',{exact:true}).fill('https://bp.zicotv.cc/channels/1');
  await page.getByRole('button',{name:'Guardar y publicar',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.channels.length===1);
  assert.deepEqual(await page.evaluate(()=>window.__published.channels[0].streams),['https://bp.zicotv.cc/api/player/1']);
  await page.goto(base+'/#/canales');
  await page.locator('.card').filter({hasText:'Prueba Zico'}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('#video');return v?.videoWidth>0&&v.currentTime>.2;},null,{timeout:20000});
  assert.equal(await page.locator('#player iframe').count(),0);
  assert.equal(requests.some(u=>u.includes('/channels/')||u.includes('/premium')),false);
  assert.ok(requests.some(u=>u.includes('seg=video')));
  assert.deepEqual(errors,[]);
  console.log('PASS: admin channel page -> saved player id -> channel card -> native HLS video in own web player');
} finally {await browser?.close();await new Promise(ok=>server.close(ok));}
