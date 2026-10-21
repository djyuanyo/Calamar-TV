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
export const ready = Promise.resolve(), auth = { currentUser: { email: 'admin@example.com', getIdToken: async () => 'token' } };
export const administrator = () => true;
export const imageService = async () => ({configured: true});
export const connectImageService = async () => ({configured: true});
export const watchAuth = () => () => {};
export const login = async () => {}, logout = async () => {}, explain = e => e.message;
export const readCatalog = async () => ({ data: structuredClone(catalog), revision });
export const publishCatalog = async data => { catalog = structuredClone(validateCatalog(data)); window.__published = catalog; sessionStorage.setItem('catalog', JSON.stringify(catalog)); return ++revision; };
export const watchCatalog = (fallback, next) => { next({ data: structuredClone(catalog) }); return () => {}; };
const present = new Map();
window.__visits = [];
export const beat = async (session, target) => { present.set(session, target); };
export const leave = async session => { present.delete(session); };
export const viewers = async target => [...present.values()].filter(t => t === target).length + 2;
export const audience = async () => [...present.values()].map(target => ({ target, minute: Math.floor(Date.now() / 60000) }));
export const purgeAudience = async () => {};
export const recordVisit = async (day, key) => { window.__visits.push([day, key]); };
export const visits = async () => [{ id: '2026-11-30', data: { 'c_sport-one': 3, last: 'c_sport-one' } }];
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
  } catch {
    // Like GitHub Pages: unknown addresses get 404.html.
    res.writeHead(404, { 'Content-Type': 'text/html' }); res.end(await readFile(resolve(root, '404.html')));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CALAMAR_CHROME_EXECUTABLE ? { executablePath: process.env.CALAMAR_CHROME_EXECUTABLE, args: JSON.parse(process.env.CALAMAR_CHROME_ARGS || '[]') } : {}), ...(process.env.CALAMAR_CHROME_CHANNEL ? { channel: process.env.CALAMAR_CHROME_CHANNEL } : {}) });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.clock.install({ time: new Date('2026-11-30T12:00:00Z') });
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
  // The home page lists only events, in one row per league with its name.
  assert.equal(await page.locator('main .rail .card:not(.event-card)').count(), 0);
  assert.equal(await page.locator('main .section-head h2').first().textContent(), 'Liga de prueba');
  const dimensions = await page.evaluate(() => {
    const cover = document.querySelector('.event-card .event-cover'), art = cover.parentElement;
    const header = document.querySelector('.brand').getBoundingClientRect(), search = document.querySelector('.search').getBoundingClientRect();
    return { cover: cover.getBoundingClientRect().toJSON(), art: art.getBoundingClientRect().toJSON(), fit: getComputedStyle(cover).objectFit, below: search.top >= header.bottom };
  });
  assert.equal(dimensions.fit, 'cover'); assert.equal(dimensions.below, true);
  assert.ok(Math.abs(dimensions.cover.width - dimensions.art.width) < 1);
  assert.ok(Math.abs(dimensions.cover.height - dimensions.art.height) < 1);
  assert.equal(await page.locator('.card:not(.event-card) .badge.live').count(), 0);
  // Until the event starts its badge shows when it starts instead of a live label.
  assert.equal(await page.locator('.event-card .badge').textContent(), 'mar 1 dic · 21:00');
  assert.equal(await page.locator('.highlight-slider .event-state').textContent(), 'mar 1 dic · 21:00');
  const heroTitle = () => page.locator('.highlight-slider .hero h1').textContent();
  assert.equal(await heroTitle(), 'Local vs visitante');
  assert.equal(await page.getByRole('button', { name: /Pausar portada|Reanudar portada/ }).count(), 0);
  await page.clock.fastForward(5001);
  assert.equal(await heroTitle(), 'Sports Two');
  await page.clock.fastForward(5001);
  assert.equal(await heroTitle(), 'Local vs visitante');
  // Swiping left shows the next highlight without opening the channel under the finger.
  const box = await page.locator('.highlight-slider .hero').boundingBox();
  const swipe = async (from, to) => {
    await page.mouse.move(box.x + box.width * from, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to, box.y + box.height * 0.7, { steps: 5 });
    await page.mouse.up();
  };
  await swipe(0.8, 0.2);
  assert.equal(await heroTitle(), 'Sports Two');
  await swipe(0.2, 0.8);
  assert.equal(await heroTitle(), 'Local vs visitante');
  assert.equal(await page.locator('#player').isHidden(), true);
  await page.locator('.slider-dots button').nth(1).click();
  assert.equal(await heroTitle(), 'Sports Two');
  await Promise.all([page.waitForRequest('https://example.com/one.mp4'), page.locator('.event-card').click()]);
  await page.locator('#player:not([hidden])').waitFor();
  // Event links use the slug of the event name, like channels.
  assert.ok(page.url().endsWith('#/evento/local-vs-visitante'));
  assert.equal(await page.locator('#player-title').textContent(), 'Local vs visitante');
  // Pressing «Ver» opens it in full screen, as in the app.
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'player');
  assert.ok(requests.includes('https://example.com/one.mp4'));
  // Sharing an event uses its preview page (cover and name in WhatsApp).
  await page.evaluate(() => { navigator.share = async data => { window.__shared = data; }; });
  await page.getByRole('button', { name: 'Compartir', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__shared), { title: 'Local vs visitante', url: 'https://djyuanyo.github.io/Calamar-TV/evento/local-vs-visitante/' });
  await page.locator('#player-viewers:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-viewers b').textContent(), '3');
  assert.equal(await page.locator('#player-viewers .sr').textContent(), '3 personas viendo');
  // The event visit also counts for the channel it plays on.
  await page.waitForFunction(() => window.__visits.length === 2);
  assert.deepEqual(await page.evaluate(() => window.__visits), [['2026-11-30', `e_${published.events[0].id}`], ['2026-11-30', 'c_sport-one']]);
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  assert.equal(await page.locator('#player-viewers').isHidden(), true);
  // Multi-screen: two videos top and bottom, three in a 2x2 grid; tapping a tile gives it the sound.
  await page.locator('.nav a').filter({ hasText: 'Multipantalla' }).click();
  await page.getByRole('button', { name: 'Sports One', exact: true }).click();
  await page.getByRole('button', { name: 'Sports Two', exact: true }).click();
  await page.getByRole('button', { name: 'Ver 2 a la vez', exact: true }).click();
  await page.locator('.multi .multi-tile').nth(1).waitFor();
  assert.deepEqual(await page.locator('.multi-grid').evaluate(g => [getComputedStyle(g).gridTemplateRows.split(' ').length, getComputedStyle(g).gridTemplateColumns.split(' ').length]), [2, 1]);
  assert.ok(requests.includes('https://example.com/two.mp4'));
  assert.deepEqual(await page.locator('.multi-tile video').evaluateAll(v => v.map(x => x.muted)), [false, true]);
  // The buttons stay hidden until a tap; a tap shows them without changing the sound.
  assert.equal(await page.locator('.multi').evaluate(m => m.classList.contains('idle')), true);
  await page.locator('.multi-tile').nth(1).click();
  assert.equal(await page.locator('.multi').evaluate(m => m.classList.contains('idle')), false);
  assert.deepEqual(await page.locator('.multi-tile video').evaluateAll(v => v.map(x => x.muted)), [false, true]);
  await page.getByRole('button', { name: '✕ Salir', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.multi') && location.hash === '#/multipantalla');
  await page.getByRole('button', { name: 'Local vs visitante', exact: true }).click();
  await page.getByRole('button', { name: 'Ver 3 a la vez', exact: true }).click();
  await page.locator('.multi .multi-tile').nth(2).waitFor();
  assert.deepEqual(await page.locator('.multi-grid').evaluate(g => [getComputedStyle(g).gridTemplateRows.split(' ').length, getComputedStyle(g).gridTemplateColumns.split(' ').length]), [2, 2]);
  await page.locator('.multi-tile').nth(2).click();
  assert.deepEqual(await page.locator('.multi-tile video').evaluateAll(v => v.map(x => x.muted)), [false, true, true]);
  await page.getByRole('button', { name: 'Oír Local vs visitante', exact: true }).click();
  assert.deepEqual(await page.locator('.multi-tile video').evaluateAll(v => v.map(x => x.muted)), [true, true, false]);
  await page.clock.fastForward(4100);
  assert.equal(await page.locator('.multi').evaluate(m => m.classList.contains('idle')), true);
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.multi'));
  await page.locator('.admin-link').click();
  await page.locator('.admin-stats a').filter({ hasText: 'Estadísticas' }).click();
  await page.getByRole('heading', { name: 'En vivo ahora', exact: true }).waitFor();
  await page.locator('.stats-table').filter({ hasText: 'Sports One' }).waitFor();
  assert.match(await page.locator('.stats-total').last().textContent(), /3 visitas/);
  await page.getByRole('button', { name: 'Año', exact: true }).click();
  assert.equal(await page.locator('.stats-chart .bar').count(), 12);
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
  // A link opened directly (no tap) cannot start in full screen: browsers do not allow it.
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  // Old links with the id keep working; a preview page not yet published falls back to the event.
  await page.goto(base + '/evento/final/');
  await page.waitForURL(/#\/evento\/final$/);
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Final');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.locator('.admin-link').click();
  await page.locator('.admin-stats a').filter({ hasText: 'Canales' }).click();
  await page.locator('.item').filter({ hasText: 'Sports Two' }).filter({ hasText: 'enlace(s)' }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForFunction(() => window.__published.events.length === 0 && window.__published.channels.length === 1);
  // A channel in a new category, then that category first in the channels menu.
  await page.getByLabel('Nombre', { exact: true }).fill('Cine Uno');
  await page.getByLabel('Categoría', { exact: true }).selectOption({ label: '+ Nueva categoría…' });
  await page.getByLabel('Nueva categoría', { exact: true }).fill('Cine');
  await page.getByLabel('Enlaces', { exact: true }).fill('https://example.com/cine.mp4');
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.channels.some(c => c.group === 'Cine'));
  await page.getByRole('heading', { name: 'Categorías', exact: true }).waitFor();
  const names = () => page.locator('.order-list li input:not([type=color])').evaluateAll(inputs => inputs.map(i => i.value));
  assert.deepEqual((await names()).slice(-2), ['Autonómicos', 'Cine']);
  // Drag Cine to the top with the handle, rename Deportes, change its colour and add an empty category.
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.locator('.order-list').scrollIntoViewIfNeeded();
  const from = await page.getByRole('button', { name: 'Mover Cine', exact: true }).boundingBox();
  const to = await page.getByRole('button', { name: 'Mover Calamar TV', exact: true }).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 2, { steps: 12 });
  await page.mouse.up();
  assert.equal((await names())[0], 'Cine');
  await page.getByRole('button', { name: 'Mover Calamar TV', exact: true }).press('ArrowUp');
  assert.deepEqual((await names()).slice(0, 2), ['Calamar TV', 'Cine']);
  await page.getByLabel('Nombre de la categoría Deportes', { exact: true }).fill('Fútbol');
  await page.getByLabel('Color de Deportes', { exact: true }).fill('#aa0000');
  await page.getByLabel('Nombre de la nueva categoría', { exact: true }).fill('Series');
  await page.getByRole('button', { name: 'Añadir categoría', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar categorías', exact: true }).click();
  await page.waitForFunction(() => window.__published.categories?.some(c => c.name === 'Fútbol'));
  const saved = await page.evaluate(() => window.__published.categories);
  assert.deepEqual(saved.slice(0, 2).map(c => c.id), ['Calamar TV', 'Cine']);
  assert.deepEqual(saved.find(c => c.id === 'Deportes'), { id: 'Deportes', name: 'Fútbol', color: '#aa0000' });
  assert.equal(saved.at(-1).name, 'Series');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => window.__published.groupOrder), undefined);
  await page.goto(base + '/#/canales');
  await page.locator('main .section-head h2').first().waitFor();
  assert.deepEqual(await page.locator('main .section-head h2').allTextContents(), ['Cine', 'Fútbol']);
  assert.deepEqual(await page.locator('.chips .chip').allTextContents(), ['Todos', 'Cine', 'Fútbol']);
  // Every card of a category shares its colour.
  assert.equal(await page.locator('.card', { hasText: 'Sports One' }).evaluate(card => card.style.getPropertyValue('--c')), '#aa0000');
  assert.equal(await page.locator('.card .card-viewers').count(),await page.locator('.card').count());
  assert.equal(await page.locator('.card-viewers svg circle').count(),await page.locator('.card').count());
  // Add a Google share link to a fresh event; provider data is isolated from the live internet.
  let scoreFinished = false, scoreOffline = false;
  const matchFixture = () => ({ id: '401882870', date: '2026-11-30T12:00Z', competitions: [{ id: '401882870', status: { displayClock: "74'", type: { state: scoreFinished ? 'post' : 'in', name: scoreFinished ? 'STATUS_FULL_TIME' : 'STATUS_SECOND_HALF', completed: scoreFinished } }, competitors: [{ homeAway: 'home', score: '2', team: { displayName: 'Levante' } }, { homeAway: 'away', score: '1', team: { displayName: 'Athletic Club' } }] }] });
  await page.route('https://calamarmenciano.com/calamar-match.php?**', route => route.fulfill({ json: { url: 'https://www.google.com/search?q=levante+ud+contra+athletic+club' } }));
  await page.route('https://site.api.espn.com/**', route => scoreOffline ? route.abort() : route.fulfill({ json: route.request().url().includes('scoreboard') ? { events: [matchFixture()] } : { header: matchFixture() } }));
  await page.goto(base + '/#/admin/evento');
  await page.getByRole('heading', { name: 'Crear evento', exact: true }).waitFor();
  await page.getByLabel('Nombre del evento', { exact: true }).fill('Levante vs Athletic');
  await page.getByLabel('Fecha y hora', { exact: false }).fill('2026-11-30T13:00');
  await page.getByLabel('O pega el enlace HTTPS de la portada', { exact: true }).fill('https://example.com/match.jpg');
  await page.getByRole('button', { name: 'Sports One', exact: true }).click();
  await page.getByLabel('Enlace del partido en Google', { exact: false }).fill('https://share.google/RSJmsOE0s8wgQUT3n');
  await page.getByRole('button', { name: 'Comprobar partido', exact: true }).click();
  await page.getByText('Levante – Athletic Club · 2 – 1 · En juego · 74′ · Resultados: ESPN', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.events.some(e => e.matchId === '401882870'));
  await page.locator('.nav a').filter({hasText:'Inicio'}).click();
  await page.locator('.event-card [data-match-id]').getByText('2 – 1 · En juego · 74′',{exact:true}).waitFor();
  await page.locator('.event-card .card-viewers b').getByText('0',{exact:true}).waitFor();
  const cardPosition=await page.locator('.event-card').evaluate(c => {const a=c.querySelector('.art').getBoundingClientRect(),b=c.querySelector('.card-viewers').getBoundingClientRect();return {right:a.right-b.right,top:b.top-a.top};});
  assert.ok(Math.abs(cardPosition.right-8)<1.5);assert.ok(Math.abs(cardPosition.top-8)<1.5);
  await page.locator('.event-card').click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'player');
  assert.equal(await page.locator('#player-title').textContent(),'Levante vs Athletic');
  assert.equal(await page.locator('#player [data-match-id]').count(),0);
  await page.evaluate(() => {document.querySelector('#player-pill').hidden=false;});
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
    await page.setViewportSize(viewport);
    const pos=await page.evaluate(() => {const root=document.querySelector('#player'),bar=root.querySelector('.player-toolbar'),pill=root.querySelector('#player-pill');return {bar:bar.getBoundingClientRect().toJSON(),pill:pill.getBoundingClientRect().toJSON(),right:root.getBoundingClientRect().right,padding:parseFloat(getComputedStyle(root.querySelector('.player-top')).paddingRight),first:bar.firstElementChild.id};});
    assert.equal(pos.first,'player-viewers');assert.ok(pos.bar.top>=pos.pill.bottom);assert.ok(pos.bar.top<=40,`Controls too low: ${pos.bar.top}`);assert.ok(Math.abs(pos.bar.right-(pos.right-pos.padding))<2);
  }
  await page.setViewportSize({width:390,height:844});
  scoreFinished = true;
  await page.clock.fastForward(31000);
  await page.locator('.event-card [data-match-id]').getByText('2 – 1 · Finalizado', { exact: true }).waitFor();
  assert.equal(await page.locator('#player-title').textContent(),'Levante vs Athletic');
  await page.locator('.event-card .card-viewers b').getByText('1',{exact:true}).waitFor();
  scoreOffline = true;
  await page.clock.fastForward(31000);
  await page.locator('.event-card [data-match-id]').getByText('Marcador no disponible', { exact: true }).waitFor();
  assert.equal(await page.locator('#player [data-match-id]').count(),0);
  // Grace is kept across a page reload and an API outage. Expiring a card keeps admin data.
  const finishRegistry=await page.evaluate(() => JSON.parse(localStorage.getItem('calamar-match-finished-v1')));
  const graceEnd=finishRegistry['401882870']+300000;
  await page.goto(base + '/?expiry=1#/inicio');
  await page.locator('.event-card').waitFor();
  const remaining=graceEnd-await page.evaluate(() => Date.now());
  assert.ok(remaining>1500);
  await page.clock.fastForward(remaining-1500);
  assert.equal(await page.locator('.event-card').count(),1);
  await page.clock.fastForward(1501);
  await page.waitForFunction(() => !document.querySelector('.event-card'));
  assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('catalog')).events.length),1);
  scoreOffline=false;scoreFinished=false;
  await page.clock.fastForward(31000);
  await page.locator('.event-card').waitFor();
  // Every event card opens, including the second item of a rail (map's index is not a picker).
  await page.evaluate(() => {
    const c=JSON.parse(sessionStorage.getItem('catalog'));
    c.events.push({ ...c.events[0], id:'zz-other-event', name:'Otro partido', featured:false, matchUrl:'', matchId:'', matchDate:'' });
    sessionStorage.setItem('catalog',JSON.stringify(c));
  });
  await page.goto(base + '/?regression=2#/inicio');
  await page.locator('.event-card').filter({hasText:'Otro partido'}).click();
  assert.equal(await page.locator('#player-title').textContent(),'Otro partido');
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id),'player');
  // Films and series: hidden in the menu until the administrator switches them on.
  const library = { attribution: 'Datos e imágenes de TMDB.', sections: {
    movies: [{ id: 'mavatar', kind: 'movie', title: 'Avatar', year: 2009, file: 'Avatar.mp4', url: 'https://calamarmenciano.com/PELIS/Avatar.mp4', status: 'matched',
      tmdb: { title: 'Avatar', year: 2009, overview: 'En el planeta Pandora…', genres: ['Ciencia ficción'], rating: 7.6, votes: 30000, runtime: 162, cast: [{ name: 'Sam Worthington', character: 'Jake Sully' }], poster: '', backdrop: '' } },
      { id: 'mtorrente', kind: 'movie', title: 'Torrente', year: 1998, file: 'Torrente.mp4', url: 'https://calamarmenciano.com/PELIS/Torrente.mp4', status: 'matched', tmdb: { title: 'Torrente', genres: ['Comedia'] } }],
    series: [{ id: 'spaco', kind: 'tv', title: 'Los hombres de Paco', folder: 'Los Hombres de Paco', status: 'matched', tmdb: { title: 'Los hombres de Paco', overview: 'Comisaría', genres: ['Comedia'] },
      episodes: [{ id: 'e1001', season: 10, episode: 1, name: 'Vuelta a empezar', url: 'https://calamarmenciano.com/SERIES/cap1001.mp4' }, { id: 'e1002', season: 10, episode: 2, url: 'https://calamarmenciano.com/SERIES/cap1002.mp4' }] }],
    documentaries: [] } };
  await page.route('https://calamarmenciano.com/calamar-library.php**', route => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify(route.request().method() === 'GET' ? library : { configured: true, folders: { movies: 'PELIS', series: 'SERIES', documentaries: 'DOCS' } }) }));
  assert.equal(await page.locator('.nav a', { hasText: 'Películas' }).isHidden(), true);
  await page.goto(base + '/#/admin/biblioteca');
  await page.getByRole('heading', { name: 'Pelis y series', exact: true }).waitFor();
  await page.locator('.library-item').filter({ hasText: 'Avatar.mp4' }).waitFor();
  await page.getByLabel('Mostrar Películas, Series y Documentales a los usuarios (web y app)').check();
  await page.waitForFunction(() => window.__published.libraryVisible === true);
  await page.goto(base + '/#/');
  await page.locator('.nav a', { hasText: 'Películas' }).click();
  // Category chips (TMDB genres of the section) between the search box and the posters.
  await page.getByRole('button', { name: 'Ciencia ficción', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 1);
  await page.getByRole('button', { name: 'Todas', exact: true }).click();
  await page.locator('.poster-card', { hasText: 'Avatar' }).click();
  await page.getByRole('heading', { name: 'Avatar', exact: true }).waitFor();
  assert.match(await page.locator('.library-facts').textContent(), /2009 · 162 min · ★ 7,6/);
  assert.match(await page.locator('.cast-list').textContent(), /Sam Worthington/);
  await page.getByRole('button', { name: '▶ Reproducir', exact: true }).click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Avatar');
  assert.ok(page.url().endsWith('#/peliculas/mavatar/ver'));
  await page.waitForFunction(() => document.getElementById('video').src === 'https://calamarmenciano.com/PELIS/Avatar.mp4');
  // Films are not live: no «En directo» pill or live button, whatever the stream says.
  await page.evaluate(() => document.getElementById('video').dispatchEvent(new Event('durationchange')));
  assert.equal(await page.locator('#player-pill').isHidden(), true);
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'player');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/peliculas/mavatar');
  await page.locator('.nav a', { hasText: 'Series' }).click();
  await page.locator('.poster-card', { hasText: 'Los hombres de Paco' }).click();
  await page.getByRole('button', { name: 'Temporada 10', exact: true }).waitFor();
  // An episode opens its own page (Capítulo 1, its name and synopsis) with the play button.
  await page.locator('.episode', { hasText: 'Capítulo 1' }).click();
  await page.getByRole('heading', { name: 'Capítulo 1', exact: true }).waitFor();
  assert.ok(page.url().endsWith('#/series/spaco/capitulo/e1001'));
  assert.equal(await page.locator('.episode-name').textContent(), 'Vuelta a empezar');
  assert.equal(await page.locator('#player').isHidden(), true);
  await page.getByRole('button', { name: '▶ Reproducir', exact: true }).click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Los hombres de Paco · T10 · Capítulo 1');
  // When it ends the next episode starts by itself.
  await page.evaluate(() => document.getElementById('video').dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => document.getElementById('player-title').textContent === 'Los hombres de Paco · T10 · Capítulo 2');
  assert.ok(page.url().endsWith('#/series/spaco/ver/e1002'));
  await page.waitForFunction(() => document.getElementById('video').src === 'https://calamarmenciano.com/SERIES/cap1002.mp4');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  // «Continuar viendo» heads the home page and opens the film where it was left.
  await page.evaluate(() => localStorage.setItem('calamar-progress-v1', JSON.stringify({ mavatar: { key: 'mavatar', page: 'peliculas', item: 'mavatar', episode: '',
    name: 'Avatar', sub: '2009', image: '', position: 1800, duration: 9720, at: Date.now() } })));
  await page.goto(base + '/#/inicio');
  await page.getByRole('heading', { name: 'Continuar viendo', exact: true }).waitFor();
  assert.equal(await page.locator('main h2').first().textContent(), 'Continuar viendo');
  assert.match(await page.locator('.continue-card').textContent(), /Avatar.*quedan 132 min/);
  await page.locator('.continue-card a').click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Avatar');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.goto(base + '/#/peliculas/mavatar');
  await page.getByRole('button', { name: '▶ Continuar · 30:00', exact: true }).waitFor();
  await page.goto(base + '/#/inicio');
  await page.getByRole('button', { name: 'Quitar Avatar de Continuar viendo' }).click();
  await page.waitForFunction(() => !document.querySelector('.continue-card'));
  assert.deepEqual(errors, []);
  console.log('UI verificada: crear evento, subir portada, buscar canal, fecha antes del inicio, carrusel automático y deslizable, espectadores y visitas, estadísticas, portada solo con eventos por liga, multipantalla, categorías con orden arrastrable, nombre y color, pelis y series, editar y retirar eventos asociados; buscador bajo cabecera.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
