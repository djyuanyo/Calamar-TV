import { chromium } from 'playwright';
import fs from 'node:fs';
const out = { console: [], failed: [], responses: [] };
const mask = (u) => { try { const x = new URL(u); return x.host + x.pathname.replace(/\/[^/]*\/[^/]*\/(\d+)$/, '/***/***/$1').slice(0, 80); } catch { return String(u).slice(0, 60); } };
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) out.console.push(m.type() + ': ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => out.console.push('pageerror: ' + String(e).slice(0, 300)));
page.on('requestfailed', (r) => out.failed.push(mask(r.url()) + ' ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (/calamarmenciano|firestore|31\.43|zicotv/.test(r.url())) out.responses.push(r.status() + ' ' + mask(r.url())); });
await page.goto('https://djyuanyo.github.io/Calamar-TV/#/canales', { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => out.console.push('goto ' + e.message));
await page.waitForTimeout(5000);
out.cards = await page.locator('.card').count();
out.firstCards = await page.locator('.card').evaluateAll((cs) => cs.slice(0, 5).map((c) => c.textContent.trim().slice(0, 40)));
const target = page.locator('.card', { hasText: 'DAZN' }).first();
await (await target.count() ? target : page.locator('.card').first()).click().catch((e) => out.console.push('click ' + e.message));
for (const t of [5, 15, 30]) {
  await page.waitForTimeout(t === 5 ? 5000 : (t === 15 ? 10000 : 15000));
  out['at' + t] = await page.evaluate(() => { const v = document.querySelector('#video'); return { title: document.querySelector('#player-title')?.textContent, status: document.querySelector('#player-status')?.textContent?.slice(0, 200), ready: v?.readyState, time: v?.currentTime, paused: v?.paused, err: v?.error?.code }; });
}
await page.screenshot({ path: 'diag/web.png' });
fs.writeFileSync('diag/web.json', JSON.stringify(out, null, 1));
await browser.close();
