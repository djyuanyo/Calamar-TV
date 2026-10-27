// The published web in Google Chrome: open «Liga Campeones» and report what the player does.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/tmp/pw/node_modules/playwright');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const log = [], net = [];
page.on('console', (m) => log.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`.slice(0, 300)));
page.on('response', (r) => { if (r.url().includes('calamar')) net.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
page.on('requestfailed', (r) => { if (r.url().includes('calamar')) net.push(`FAILED ${r.url().split('?')[0]} ${r.failure()?.errorText}`); });
await page.goto('https://djyuanyo.github.io/Calamar-TV/#/canales', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
const link = page.locator('a, button').filter({ hasText: /^Liga Campeones$/ }).first();
const found = await link.count();
if (found) await link.click();
await page.waitForTimeout(1500);
const cards = page.locator('.card');
log.push('cards ' + await cards.count() + ' first: ' + (await cards.first().textContent()));
await cards.first().click();
const samples = [];
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2500);
  samples.push(await page.evaluate(() => { const v = document.querySelector('video'); return v ? { t: Math.round(v.currentTime * 10) / 10, rs: v.readyState, paused: v.paused, err: v.error?.code || 0, status: document.getElementById('player-status')?.textContent || '' } : null; }));
}
await page.screenshot({ path: 'diag/web.png' });
writeFileSync('diag/cut.json', JSON.stringify({ found, samples, net: net.slice(0, 40), log: log.slice(-40) }, null, 1));
await browser.close();
