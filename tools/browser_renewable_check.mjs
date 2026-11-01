// Actual hls.js + MPEG-TS decoding. Isolated fixtures: never contacts the real provider or catalog.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CALAMAR_PLAYWRIGHT || 'playwright');
const hlsFile = process.env.CALAMAR_HLS || resolve(process.env.CALAMAR_PLAYWRIGHT, '../hls.js/dist/hls.min.js');
const root = resolve('web'), mime = { '.html':'text/html', '.js':'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!path.startsWith(root + '/')) throw Error();
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless:true, ...(process.env.CALAMAR_CHROME_EXECUTABLE ? { executablePath:process.env.CALAMAR_CHROME_EXECUTABLE, args:JSON.parse(process.env.CALAMAR_CHROME_ARGS || '[]') } : {}), ...(process.env.CALAMAR_CHROME_CHANNEL ? {channel:process.env.CALAMAR_CHROME_CHANNEL} : {}) });
  const base = `http://127.0.0.1:${server.address().port}`;
  const ts = await readFile('app/src/androidTest/assets/live.ts'), hls = await readFile(hlsFile);
  let pages = 0, segments = 0, hostRequests = 0;
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const u = new URL(route.request().url());
    if (u.origin === base) return route.continue();
    const headers = {'Access-Control-Allow-Origin':'*'};
    if (u.hostname === 'cdn.jsdelivr.net') return route.fulfill({contentType:'text/javascript',body:hls});
    if (u.hostname === 'calamarmenciano.com') { hostRequests++; return route.abort(); }
    if (u.pathname === '/api/v1/events/98019') return route.fulfill({headers,json:{data:{sources:[{locked:true,player_url:'https://bp.zicotv.cc/api/player/99'},{player_url:'https://bp.zicotv.cc/api/player/4'}]}}});
    if (u.pathname === '/api/player/4') {
      pages++;
      return route.fulfill({headers,contentType:'text/html',body:'var ZT_SOURCES = ' + JSON.stringify([
        {locked:true,url:'https://cdn.example/locked.m3u8'},
        {url:`https://cdn.example/live.m3u8?token=fixture-${Math.floor(Date.now()/1000)+45}-&version=${pages}`}
      ]) + ';'});
    }
    if (u.pathname === '/live.m3u8') return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:'#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:9\n'
      + Array.from({length:4},(_,i)=>(i ? '#EXT-X-DISCONTINUITY\n':'') + `#EXTINF:8.023,\nhttps://cdn.example/segment.ts?n=${i}\n`).join('') + '#EXT-X-ENDLIST\n'});
    if (u.pathname === '/segment.ts') { segments++; return route.fulfill({headers,contentType:'video/mp2t',body:ts}); }
    throw Error('Unexpected external request: ' + u.origin + u.pathname);
  });
  for (const source of ['https://bp.zicotv.cc/api/player/4','https://bp.zicotv.cc/events/98019']) {
    const before = pages, beforeSegments = segments;
    // A different document per case, as opening a new WebView does in the app.
    const fixtureCase = source.includes('/events/') ? 'event' : 'channel';
    await page.goto(base + '/direct-player.html?case=' + fixtureCase + '#' + encodeURIComponent(source));
    // Autoplay may already be playing on this fast fixture. An unconditional toggle would pause it.
    await page.locator('#video').evaluate(video => { video.muted = true; void video.play().catch(() => {}); });
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v.videoWidth > 0 && v.currentTime > 0.3 && !v.paused;
    }).catch(async error => {
      console.error({source,pages,segments,hostRequests,errors,state:await page.evaluate(() => {
        const v=document.querySelector('video');
        return {status:document.querySelector('#status').textContent,paused:v.paused,ready:v.readyState,width:v.videoWidth,time:v.currentTime,error:v.error?.message};
      })}); throw error;
    });
    assert.ok(segments > beforeSegments, 'Video segments were not received');
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'En directo');
    // A fresh public page/token must be obtained automatically before the 45-second token expires.
    const until = Date.now() + 22000;
    while (pages <= before + 1 && Date.now() < until) await new Promise(done => setTimeout(done, 100));
    assert.ok(pages > before + 1, `Stable channel did not renew its token (${fixtureCase}, ${pages}/${before})`);
    await page.getByRole('button',{name:'Reintentar',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('video').videoWidth > 0 && document.querySelector('video').currentTime > 0.3 && !document.querySelector('video').paused);
    assert.equal(hostRequests,0,'Working web connection must not depend on the unreachable hosting');
  }
  assert.deepEqual(errors, []);
  console.log('Integrated web player decoded real MPEG-TS, renewed channel/event tokens and retried without hosting.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
