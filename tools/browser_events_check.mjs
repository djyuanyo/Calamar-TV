// Exercise the real UI against an isolated catalog; never signs in or writes to Firebase.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CALAMAR_PLAYWRIGHT || 'playwright');
const root = resolve('web');
const fixture = { channels: [
  { id: 'sport-one', name: 'Sports One', group: 'Deportes', streams: ['https://example.com/one.mp4'] },
  { id: 'sport-two', name: 'Sports Two', group: 'Deportes', streams: ['https://example.com/two.mp4'] },
], featured: ['sport-two'], hidden: [], events: [], leagues: [], teams: [] };
const firebase = `
import { validateCatalog } from './shared-catalog.js';
let catalog = JSON.parse(sessionStorage.getItem('catalog') || 'null') || ${JSON.stringify(fixture)}, revision = 1;
export const ready = Promise.resolve(), auth = { currentUser: { email: 'admin@example.com' } };
export const administrator = () => true;
export const watchAuth = () => () => {};
export const login = async () => {}, logout = async () => {}, explain = e => e.message;
export const readCatalog = async () => ({ data: structuredClone(catalog), revision });
export const publishCatalog = async data => { catalog = structuredClone(validateCatalog(data)); window.__published = catalog; sessionStorage.setItem('catalog', JSON.stringify(catalog)); return ++revision; };
export const watchCatalog = (fallback, next) => { next({ data: structuredClone(catalog) }); return () => {}; };
`;
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/firebase.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(firebase); return; }
  if (path === '/data/custom.json' || path === '/data/tdt.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(path.includes('custom') ? fixture : { channels: [] })); return; }
  try {
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + '/')) throw Error();
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CALAMAR_CHROME_CHANNEL ? { channel: process.env.CALAMAR_CHROME_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.install();
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base + '/#/admin/ligas');
  await page.getByLabel('Nombre de liga', { exact: true }).fill('Liga de prueba');
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published?.leagues.length === 1);
  const leagueId = await page.evaluate(() => window.__published.leagues[0].id);
  await page.locator('.admin-stats a').filter({ hasText: 'Equipos' }).click();
  await page.getByLabel('Nombre de equipo', { exact: true }).fill('Local');
  await page.getByLabel('Liga principal', { exact: false }).selectOption(leagueId);
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.teams.length === 1);
  await page.getByLabel('Nombre de equipo', { exact: true }).fill('Visitante');
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.teams.length === 2);
  const teamIds = await page.evaluate(() => window.__published.teams.map(t => t.id));
  await page.locator('.admin-stats a').filter({ hasText: 'Eventos' }).click();
  await page.getByLabel('Liga', { exact: true }).selectOption(leagueId);
  await page.getByLabel('Equipo local', { exact: true }).selectOption(teamIds[0]);
  await page.getByLabel('Equipo visitante', { exact: true }).selectOption(teamIds[1]);
  await page.getByLabel('Nombre del evento', { exact: true }).fill('Local vs visitante');
  await page.getByLabel('Fecha y hora', { exact: false }).fill('2026-12-01T21:00');
  await page.getByLabel('Destacar en portada', { exact: true }).check();
  await page.locator('input[type=file]').setInputFiles({ name: 'portada.png', mimeType: 'image/png', buffer: await readFile('web/assets/calamar-menciano-tv.png') });
  await page.getByText('Portada preparada.', { exact: true }).waitFor();
  await page.getByPlaceholder('Buscar entre tus canales creados').fill('One');
  await page.getByRole('button', { name: 'Sports One', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published?.events.length === 1);
  const published = await page.evaluate(() => window.__published);
  assert.equal(published.events[0].channelId, 'sport-one');
  assert.equal(published.events[0].startAt, '2026-12-01T20:00:00.000Z');
  assert.equal(published.events[0].leagueId, leagueId);
  assert.equal(published.events[0].homeTeamId, teamIds[0]);
  assert.match(published.events[0].cover, /^data:image\/jpeg;base64,/);
  await page.locator('.nav a').filter({ hasText: 'Inicio' }).click();
  await page.locator('.event-card').waitFor();
  assert.equal(await page.locator('a[data-route=futbol]').count(), 0);
  const dimensions = await page.evaluate(() => {
    const cover = document.querySelector('.event-card .event-cover'), art = cover.parentElement;
    const header = document.querySelector('.brand').getBoundingClientRect(), search = document.querySelector('.search').getBoundingClientRect();
    return { cover: cover.getBoundingClientRect().toJSON(), art: art.getBoundingClientRect().toJSON(), fit: getComputedStyle(cover).objectFit, below: search.top >= header.bottom };
  });
  assert.equal(dimensions.fit, 'cover'); assert.equal(dimensions.below, true);
  assert.ok(Math.abs(dimensions.cover.width - dimensions.art.width) < 1);
  assert.ok(Math.abs(dimensions.cover.height - dimensions.art.height) < 1);
  assert.equal(await page.locator('.card:not(.event-card) .badge.live').count(), 0);
  assert.equal(await page.locator('.highlight-slider .hero h1').textContent(), 'Local vs visitante');
  await page.clock.fastForward(5001);
  assert.equal(await page.locator('.highlight-slider .hero h1').textContent(), 'Sports Two');
  await page.getByRole('button', { name: 'Pausar portada', exact: true }).click();
  await page.clock.fastForward(5001);
  assert.equal(await page.locator('.highlight-slider .hero h1').textContent(), 'Sports Two');
  await page.locator('.event-card').click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.match(page.url(), /#\/evento\/evento-/);
  assert.ok(page.url().endsWith(published.events[0].id));
  assert.equal(await page.locator('#player-title').textContent(), 'Local vs visitante');
  assert.ok(requests.includes('https://example.com/one.mp4'));
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.locator('.admin-link').click();
  await page.locator('.admin-stats a').filter({ hasText: 'Eventos' }).click();
  await page.locator('.item').filter({ hasText: 'Local vs visitante' }).getByRole('link', { name: 'Editar', exact: true }).click();
  await page.getByRole('heading', { name: 'Editar evento', exact: true }).waitFor();
  await page.getByLabel('Nombre del evento', { exact: true }).fill('Final');
  await page.getByPlaceholder('Buscar entre tus canales creados').fill('Two');
  await page.getByRole('button', { name: 'Sports Two', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  console.log('Editar evento', await page.locator('form').evaluate(form => ({ valid: form.checkValidity(), invalid: [...form.elements].filter(e => e.checkValidity && !e.checkValidity()).map(e => ({type:e.type,value:e.value.slice(0,80),message:e.validationMessage})), message: form.querySelector('.error')?.textContent, name: form.querySelector('input[aria-label="Nombre del evento"]')?.value, published: window.__published.events.map(e => ({id:e.id,name:e.name})) })));
  await page.waitForFunction(() => window.__published.events[0].name === 'Final');
  assert.equal((await page.evaluate(() => window.__published)).events[0].channelId, 'sport-two');
  const eventId = published.events[0].id;
  assert.equal((await page.evaluate(() => window.__published)).events[0].id, eventId);
  await page.goto(base + '/#/evento/' + eventId);
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Final');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.locator('.admin-link').click();
  await page.locator('.admin-stats a').filter({ hasText: 'Canales' }).click();
  await page.locator('.item').filter({ hasText: 'Sports Two' }).filter({ hasText: 'enlace(s)' }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(() => window.__published.events.length === 0 && window.__published.channels.length === 1);
  assert.deepEqual(errors, []);
  console.log('UI verificada: crear evento, subir portada, buscar canal, abrir reproducción, editar y retirar eventos asociados; buscador bajo cabecera.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
