import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CALAMAR_PLAYWRIGHT || 'playwright');
const root = await mkdtemp(join(tmpdir(), 'test-calamar-tizen-'));
const artifact = resolve(process.argv[2]);
execFileSync('unzip', ['-q', artifact, '-d', join(root, 'app')]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/downloads/Calamar-TV-Tizen.wgt') {
      res.writeHead(200, { 'Content-Type': 'application/widget' }).end(await readFile(artifact));
      return;
    }
    const packaged = path.startsWith('/app/');
    const base = packaged ? join(root, 'app') : resolve('web');
    const name = resolve(base, '.' + ((packaged ? path.slice(4) : path) || '/'));
    const file = name === base ? join(base, 'index.html') : name;
    if (!file.startsWith(base + '/')) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}`;
const samsungUA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 Chrome/94.0.4606.31 TV Safari/537.36';
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: process.env.CALAMAR_CHROME_CHANNEL || 'chrome' });
  const tv = await browser.newPage({ userAgent: samsungUA, acceptDownloads: true });
  await tv.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await tv.goto(url);
  assert.equal(await tv.getByRole('button', { name: 'Temporizador' }).count(), 0);
  const link = tv.getByRole('link', { name: 'Descargar para Samsung TV' });
  assert.equal(await link.getAttribute('href'), 'downloads/Calamar-TV-Tizen.wgt');
  const downloading = tv.waitForEvent('download');
  await link.click();
  assert.equal((await downloading).suggestedFilename(), 'Calamar-TV-Tizen.wgt');
  await tv.getByRole('link', { name: 'Cómo instalar en Samsung TV' }).click();
  await tv.getByRole('heading', { name: 'Calamar TV para Samsung TV' }).waitFor();

  const app = await browser.newPage({ userAgent: samsungUA });
  const errors = [];
  app.on('pageerror', error => errors.push(error.message));
  await app.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await app.addInitScript(() => {
    delete Array.prototype.at;
    delete Object.hasOwn;
    delete window.structuredClone;
    delete AbortSignal.timeout;
    delete AbortSignal.any;
  });
  await app.goto(url + '/app/');
  assert.equal(await app.locator('html').getAttribute('data-platform'), 'tizen');
  assert.ok(await app.evaluate(() => window.Hls && window.mpegts && window.calamarTizenData['data/tdt.json'].channels.length > 0));
  assert.equal(await app.locator('#download-app').count(), 0);
  await app.evaluate(() => {
    const dialog = document.createElement('dialog');
    const first = document.createElement('button'), second = document.createElement('button');
    first.textContent = 'Primera opción';
    second.textContent = 'Segunda opción';
    dialog.append(first, second);
    document.body.append(dialog);
    dialog.showModal();
    first.focus();
  });
  await app.keyboard.press('ArrowRight');
  assert.equal(await app.evaluate(() => document.activeElement.textContent), 'Segunda opción');
  await app.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'GoBack', bubbles: true })));
  assert.equal(await app.locator('dialog[open]').count(), 0);
  assert.deepEqual(errors, []);

  const phone = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0.0.0 Mobile Safari/537.36',
    hasTouch: true,
  });
  await phone.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await phone.clock.install();
  await phone.goto(url + '/direct-player.html');
  const timerButton = phone.getByRole('button', { name: 'Temporizador' });
  await timerButton.click();
  const timerDialog = phone.getByRole('dialog', { name: 'Temporizador' });
  await timerDialog.getByLabel('Minutos').fill('1');
  await timerDialog.getByRole('button', { name: 'Iniciar' }).click();
  await phone.clock.fastForward(60001);
  assert.match(await phone.locator('#status').textContent(), /detenida por el temporizador/);
  await timerButton.click();
  await timerDialog.getByRole('button', { name: '15 min' }).click();
  await timerDialog.getByRole('button', { name: 'Iniciar' }).click();
  await phone.getByRole('button', { name: /Temporizador ·/ }).click();
  await timerDialog.getByRole('button', { name: 'Cancelar temporizador' }).click();
  assert.equal(await timerButton.getAttribute('aria-pressed'), 'false');
  console.log('Samsung download, packaged app startup and remote navigation verified.');
} finally {
  await browser?.close();
  await new Promise(ok => server.close(ok));
  await rm(root, { recursive: true, force: true });
}
