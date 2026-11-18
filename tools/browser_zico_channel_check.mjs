// Paste a channel page in the real admin, save it, then open the provider iframe from its card.
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
const testPlayer = `<p>Reproductor oficial de prueba</p>
  <button>Play</button><output></output><video muted playsinline></video>
  <script>
    document.querySelector('button').onclick = async () => {
      const popup = window.open('https://ads.example/popup', '_blank');
      document.querySelector('output').textContent = popup ? 'Ventana abierta' : 'Ventana bloqueada';
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      const video = document.querySelector('video');
      video.onplaying = () => { video.dataset.playing = 'true'; };
      video.srcObject = canvas.captureStream(20);
      setInterval(() => context.fillRect(0, 0, canvas.width, canvas.height), 50);
      await video.play();
    };
  </script>`;
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
  const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true}), requests=[],errors=[];
  // The fixture schedules a match an hour ahead, which must stay on the same Madrid day.
  await page.clock.install({ time: new Date('2026-11-13T12:00:00Z') });
  let premiumConfigured = true;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=> {
    const u = new URL(route.request().url());
    if (u.origin===base) return route.continue();
    requests.push(u.href);
    const headers={'access-control-allow-origin':'*'};
    if (u.hostname==='cdn.jsdelivr.net' && u.pathname.includes('/hls.js@')) return route.fulfill({contentType:'text/javascript',body:hls});
    if (u.href==='https://bp.zicotv.cc/api/v1/events/116061') return route.fulfill({headers,json:{data:{sources:[
      {source:'own',channel_id:56429,name:'[RAVEN] DAZN EVENTOS 17',player_url:'https://bp.zicotv.cc/api/player/56429',is_premium:false},
    ]}}});
    if (u.href==='https://bp.zicotv.cc/api/v1/events/701') return route.fulfill({headers,json:{data:{sources:[
      {type:'direct',url:'https://ads.example/preroll.mp4'},
      {type:'iframe',url:'https://ads.example/player'},
      {type:'direct',url:'https://cdn.example/fallback.m3u8'},
    ]}}});
    if (u.hostname==='cdn.example' && u.pathname==='/fallback.m3u8') return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-TARGETDURATION:9\n#EXTINF:8.023,\nvideo.ts\n#EXT-X-ENDLIST\n'});
    if (u.hostname==='cdn.example' && u.pathname==='/video.ts') return route.fulfill({headers,contentType:'video/mp2t',body:segment});
    if (u.hostname==='bp.zicotv.cc' && ['/api/player/1','/api/player/4','/api/player/56429'].includes(u.pathname))
      return route.fulfill({contentType:'text/html',body:testPlayer});
    if (u.hostname==='calamarmenciano.com' && u.searchParams.has('zico_embed')) {
      assert.equal(route.request().method(),'POST');
      assert.equal(u.searchParams.get('zico_mode'),'token');
      if (!premiumConfigured) return route.fulfill({headers,status:409,json:{zicoEmbed:1,error:'Falta configurar ZicoTV Premium en el panel.'}});
      const player = u.searchParams.get('zico_embed');
      if (player.endsWith('/56429')) assert.equal(u.searchParams.get('zico_event'),'https://bp.zicotv.cc/events/116061');
      return route.fulfill({headers,json:{zicoEmbed:1,mode:'token',url:player+'?token=sample-embed-token-test'}});
    }
    if (u.hostname==='calamarmenciano.com' && u.searchParams.has('event'))
      return route.fulfill({headers,status:403});
    return route.abort();
  });
  const wakeArea = page.locator('#player-frame-wake');
  const closePlayer = async () => {
    if (await wakeArea.isVisible()) await wakeArea.tap();
    await page.locator('#player-close').click();
  };
  const blockedPopupAndPlaying = async frame => {
    if (await wakeArea.isVisible()) await wakeArea.tap();
    const inside = frame.contentFrame();
    await inside.getByRole('button', {name:'Play',exact:true}).click();
    await inside.getByText('Ventana bloqueada',{exact:true}).waitFor();
    await inside.locator('video[data-playing="true"]').waitFor({timeout:5000});
    assert.equal(page.context().pages().length, 1);
  };
  const embedded = async channel => {
    const frame = page.locator('#player iframe');
    await frame.waitFor();
    assert.equal(await frame.getAttribute('src'), `https://bp.zicotv.cc/api/player/${channel}?token=sample-embed-token-test`);
    assert.equal(await frame.getAttribute('referrerpolicy'),'origin');
    assert.equal(await frame.getAttribute('sandbox'), channel === 4 ? 'allow-scripts allow-same-origin allow-forms allow-presentation' : null);
    assert.ok((await frame.getAttribute('allow')).includes('fullscreen'));
    await frame.contentFrame().getByText('Reproductor oficial de prueba').waitFor();
    assert.equal(requests.some(url=>new URL(url).searchParams.has('page')),false);
  };
  await page.goto(base+'/#/admin/nuevo');
  await page.getByLabel('Nombre',{exact:true}).fill('Prueba Zico');
  await page.getByLabel('Enlaces',{exact:true}).fill('https://bp.zicotv.cc/channels/4');
  await page.getByRole('button',{name:'Guardar y publicar',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.channels.length===1);
  assert.deepEqual(await page.evaluate(()=>window.__published.channels[0].streams),['https://bp.zicotv.cc/api/player/4']);
  await page.goto(base+'/#/canales');
  await page.locator('.card').filter({hasText:'Prueba Zico'}).click();
  await embedded(4);
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');
  assert.equal(await page.locator('#player-share').isVisible(),false);
  await wakeArea.tap();
  assert.equal(await page.locator('#player-share').isVisible(),true);
  await page.clock.runFor(3500);
  assert.equal(await page.locator('#player-share').isVisible(),false);
  await blockedPopupAndPlaying(page.locator('#player iframe'));
  assert.equal(requests.some(u=>u.includes('/channels/')||u.includes('/premium')),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: admin channel page -> saved player id -> channel card -> official iframe');
  await closePlayer();
  premiumConfigured = false;
  await page.locator('.card').filter({hasText:'Prueba Zico'}).click();
  await page.getByText('Falta configurar ZicoTV Premium en el panel.').waitFor();
  assert.equal(await page.locator('#player iframe').count(),0);
  await page.getByRole('button',{name:'Ver con publicidad'}).click();
  await page.locator('#player iframe').waitFor();
  assert.equal(await page.locator('#player iframe').getAttribute('src'),'https://bp.zicotv.cc/api/player/4');
  await blockedPopupAndPlaying(page.locator('#player iframe'));
  await closePlayer();
  premiumConfigured = true;
  const start_time = await page.evaluate(() => new Date(Date.now()+3600000).toISOString());
  let ownChannel = true;
  await page.route('https://bp.zicotv.cc/api/v1/events',route=>route.fulfill({headers:{'access-control-allow-origin':'*'},json:{total:3,data:[
    {id:700,title:'Partido con canal propio',status:'scheduled',sport_category:'Soccer',league:'Liga de prueba',start_time,sources:[
      ...(ownChannel ? [{source:'own',channel_id:1,url:'https://bp.zicotv.cc/api/player/1'}] : []),
      {source:'manual',type:'iframe',url:'https://example.com/other-player'},
    ]},
    {id:701,title:'Partido solo externo',status:'scheduled',sport_category:'Soccer',league:'Liga de prueba',start_time,sources:[
      {source:'manual',type:'iframe',url:'https://example.com/external'},
    ]},
    {id:702,title:'Partido sin fuentes',status:'scheduled',sport_category:'Soccer',league:'Liga de prueba',start_time,sources:[]},
  ]}}));
  await page.goto(base+'/#/admin/evento');
  await page.getByRole('button',{name:'Importar / actualizar agenda de ZicoTV',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.events.some(e=>e.id==='zico-event-700'));
  assert.deepEqual(await page.evaluate(()=>window.__published.events.map(e=>[e.id,e.streams])),
    [['zico-event-700',['https://bp.zicotv.cc/channels/1']],['zico-event-701',['https://bp.zicotv.cc/events/701']]]);
  // Saving the event form must preserve /channels/, rather than silently converting it back to /api/player/.
  await page.goto(base+'/#/admin/editar-evento/zico-event-700');
  assert.equal(await page.getByLabel('Enlaces adicionales del evento',{exact:true}).inputValue(),'https://bp.zicotv.cc/channels/1');
  await page.getByLabel('Nombre del evento',{exact:true}).fill('Partido editado con canal');
  await page.getByRole('button',{name:'Guardar y publicar',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.events.find(e=>e.id==='zico-event-700')?.name==='Partido editado con canal');
  assert.deepEqual(await page.evaluate(()=>window.__published.events.find(e=>e.id==='zico-event-700').streams),['https://bp.zicotv.cc/channels/1']);
  await page.goto(base+'/#/admin/evento');
  ownChannel = false;
  await page.getByRole('button',{name:'Importar / actualizar agenda de ZicoTV',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.events.find(e=>e.id==='zico-event-700')?.streams[0]==='https://bp.zicotv.cc/events/700');
  ownChannel = true;
  await page.getByRole('button',{name:'Importar / actualizar agenda de ZicoTV',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.events.find(e=>e.id==='zico-event-700')?.streams[0]==='https://bp.zicotv.cc/channels/1');
  assert.deepEqual(await page.evaluate(()=>window.__published.events.find(e=>e.id==='zico-event-700').streams),['https://bp.zicotv.cc/channels/1']);
  await page.goto(base+'/#/directo');
  await page.locator('.event-card').filter({hasText:'Partido editado con canal'}).click();
  await embedded(1);
  await closePlayer();
  await page.goto(base+'/#/admin/editar-evento/zico-event-700');
  await page.getByLabel('Enlaces adicionales del evento',{exact:true}).fill('https://bp.zicotv.cc/events/116061');
  await page.getByRole('button',{name:'Guardar y publicar',exact:true}).click();
  await page.waitForFunction(()=>window.__published?.events.find(event=>event.id==='zico-event-700')?.streams[0]==='https://bp.zicotv.cc/events/116061');
  assert.deepEqual(await page.evaluate(()=>window.__published.events.find(event=>event.id==='zico-event-700').zicoManualStreams),['https://bp.zicotv.cc/events/116061']);
  await page.goto(base+'/#/admin/evento');
  await page.getByRole('button',{name:'Importar / actualizar agenda de ZicoTV',exact:true}).click();
  await page.getByText(/^Guardado\. Agenda de ZicoTV:/).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.__published.events.find(event=>event.id==='zico-event-700').streams),['https://bp.zicotv.cc/events/116061']);
  await page.goto(base+'/#/directo');
  await page.locator('.event-card').filter({hasText:'Partido editado con canal'}).click();
  await embedded(56429);
  assert.ok(requests.includes('https://bp.zicotv.cc/api/v1/events/116061'));
  assert.deepEqual(errors,[]);
  await closePlayer();
  await page.locator('.event-card').filter({hasText:'Partido solo externo'}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('#video');return v?.videoWidth>0&&v.currentTime>.2;},null,{timeout:20000});
  assert.equal(await page.locator('#player iframe').count(),0);
  assert.ok(requests.includes('https://cdn.example/fallback.m3u8'));
  assert.equal(requests.some(url=>new URL(url).hostname==='ads.example'),false);
  console.log('PASS: Zico channels and events mount the official iframe; direct HLS keeps our player');
} finally {await browser?.close();await new Promise(ok=>server.close(ok));}
