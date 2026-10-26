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
export const administrator = (user) => user === undefined || user?.email === 'admin@example.com';
export const imageService = async () => ({configured: true});
export const connectImageService = async () => ({configured: true});
export const watchAuth = (changed) => { (window.__authWatchers ||= []).push(changed); return () => {}; };
export const login = async () => {}, logout = async () => {}, explain = e => e.message;
export const readCatalog = async () => ({ data: structuredClone(catalog), revision });
export const publishCatalog = async data => { catalog = structuredClone(validateCatalog(data)); window.__published = catalog; sessionStorage.setItem('catalog', JSON.stringify(catalog)); return ++revision; };
export const watchCatalog = (fallback, next) => { const send = () => next({ data: structuredClone(catalog) }); if (sessionStorage.getItem('slowCatalog')) setTimeout(send, 1500); else send(); return () => {}; };
const present = new Map();
window.__visits = [];
export const beat = async (session, target) => { present.set(session, target); };
export const leave = async session => { present.delete(session); };
export const viewers = async target => [...present.values()].filter(t => t === target).length + 2;
export const audience = async () => [...present.values()].map(target => ({ target, minute: Math.floor(Date.now() / 60000) }));
export const viewersOf = async targets => new Map(targets.map(target => [target, [...present.values()].filter(t => t === target).length]));
export const purgeAudience = async () => {};
export const recordVisit = async (day, key) => { window.__visits.push([day, key]); };
export const visits = async () => [{ id: '2026-11-30', data: { 'c_sport-one': 3, last: 'c_sport-one' } }];
export const readLibrarySettings = async () => window.__librarySettings || { tmdb: 'abcdef0123456789abcdef0123456789', folders: { movies: 'https://drive.google.com/drive/folders/PELISPELISPELISPELIS12345' } };
export const saveLibrarySettings = async (settings) => { window.__librarySettings = settings; };
export const publishLibraryParts = async (parts) => { window.__libraryParts = parts; };
export const publishDeviceLogin = async (id) => { window.__deviceLogin = id; };
export const watchDeviceLogin = (id, changed) => { window.__deviceUsed = () => changed(false); return () => {}; };
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
  // An event without a match link opens in full screen, with no match data.
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'player');
  assert.equal(await page.locator('#match-center').isHidden(), true);
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
  // ESPN's summary as the match page reads it: key events, team statistics, line-ups and game information.
  const matchSummary = () => ({ header: { ...matchFixture(), league: { name: 'LaLiga' } },
    keyEvents: [{ type: { type: 'goal', text: 'Goal' }, scoringPlay: true, clock: { displayValue: "12'" }, team: { displayName: 'Levante' }, participants: [{ athlete: { displayName: 'Carlos Álvarez' } }] },
      { type: { type: 'yellow-card', text: 'Yellow Card' }, clock: { displayValue: "30'" }, team: { displayName: 'Athletic Club' }, participants: [{ athlete: { displayName: 'Oihan Sancet' } }] },
      { type: { type: 'substitution', text: 'Substitution' }, clock: { displayValue: "60'" }, team: { displayName: 'Athletic Club' }, participants: [{ athlete: { displayName: 'Nico Williams' } }, { athlete: { displayName: 'Iñaki Williams' } }] }],
    boxscore: { teams: [{ team: { displayName: 'Levante' }, statistics: [{ name: 'possessionPct', displayValue: '58' }, { name: 'totalShots', displayValue: '14' }, { name: 'shotsOnTarget', displayValue: '6' }, { name: 'wonCorners', displayValue: '9' }, { name: 'yellowCards', displayValue: '0' }] },
      { team: { displayName: 'Athletic Club' }, statistics: [{ name: 'possessionPct', displayValue: '42' }, { name: 'totalShots', displayValue: '9' }, { name: 'shotsOnTarget', displayValue: '3' }, { name: 'wonCorners', displayValue: '1' }, { name: 'yellowCards', displayValue: '1' }] }],
      form: [{ team: { displayName: 'Levante' }, events: [{ gameResult: 'W', score: '2-0' }, { gameResult: 'D', score: '1-1' }, { gameResult: 'L', score: '0-1' }] }] },
    headToHeadGames: [{ team: { id: '1', displayName: 'Levante' }, events: [{ id: 'g1', gameDate: '2025-03-01T20:00Z', homeTeamId: '1', score: '1-2', leagueName: 'LaLiga', opponent: { displayName: 'Athletic Club' } }] }],
    rosters: [{ homeAway: 'home', formation: '4-4-2', roster: [{ starter: true, jersey: '1', athlete: { displayName: 'Andrés Fernández' }, position: { abbreviation: 'G' }, formationPlace: '1' }, { starter: false, jersey: '20', athlete: { displayName: 'Roger Brugué' }, position: { abbreviation: 'F' } }] },
      { homeAway: 'away', formation: '4-2-3-1', roster: [{ starter: true, jersey: '13', athlete: { displayName: 'Julen Agirrezabala' }, position: { abbreviation: 'G' }, formationPlace: '1' }, { starter: true, jersey: '11', athlete: { displayName: 'Iñaki Williams' }, position: { abbreviation: 'F' }, subbedOut: true, formationPlace: '9' }] }],
    gameInfo: { venue: { fullName: 'Estadio Ciutat de València', address: { city: 'Valencia', country: 'España' } }, attendance: 21000, officials: [{ displayName: 'Mateu Lahoz', position: { displayName: 'Referee' } }] } });
  await page.route('https://site.api.espn.com/**', route => scoreOffline ? route.abort() : route.fulfill({ json: route.request().url().includes('scoreboard') ? { events: [matchFixture()] } : matchSummary() }));
  await page.goto(base + '/#/admin/evento');
  await page.getByRole('heading', { name: 'Crear evento', exact: true }).waitFor();
  await page.getByLabel('Nombre del evento', { exact: true }).fill('Levante vs Athletic');
  await page.getByLabel('Fecha y hora', { exact: false }).fill('2026-11-30T13:00');
  await page.getByLabel('O pega el enlace HTTPS de la portada', { exact: true }).fill('https://example.com/match.jpg');
  await page.getByRole('button', { name: 'Sports One', exact: true }).click();
  await page.getByLabel('Enlace del partido en Google', { exact: false }).fill('https://share.google/RSJmsOE0s8wgQUT3n');
  await page.getByRole('button', { name: 'Comprobar partido', exact: true }).click();
  await page.getByText(/^Partido: Levante – Athletic Club · 30 nov.* · 2 – 1 · En juego · 74′ · Resultados: ESPN$/).waitFor();
  // A link that is not recognised can be replaced by choosing the match from ESPN's list for that date.
  await page.getByRole('button', { name: 'Elegir el partido de la lista', exact: true }).click();
  await page.getByLabel('Buscar en ESPN', { exact: false }).fill('athletic');
  await page.locator('.match-option', { hasText: 'Levante – Athletic Club' }).click();
  await page.getByText(/^Partido elegido: Levante – Athletic Club · 30 nov/).waitFor();
  assert.equal(await page.getByLabel('Enlace del partido en Google', { exact: false }).inputValue(), 'https://share.google/RSJmsOE0s8wgQUT3n');
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.events.some(e => e.matchId === '401882870'));
  await page.locator('.nav a').filter({hasText:'Inicio'}).click();
  await page.locator('.event-card [data-match-id]').getByText('2 – 1 · En juego · 74′',{exact:true}).waitFor();
  await page.locator('.event-card .card-viewers b').getByText('0',{exact:true}).waitFor();
  const cardPosition=await page.locator('.event-card').evaluate(c => {const a=c.querySelector('.art').getBoundingClientRect(),b=c.querySelector('.card-viewers').getBoundingClientRect();return {right:a.right-b.right,top:b.top-a.top};});
  assert.ok(Math.abs(cardPosition.right-8)<1.5);assert.ok(Math.abs(cardPosition.top-8)<1.5);
  await page.locator('.event-card').click();
  await page.locator('#player:not([hidden])').waitFor();
  // An event with a match link stays in the page: the match's information, statistics and line-ups under the video.
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), undefined);
  assert.equal(await page.locator('#player-title').textContent(),'Levante vs Athletic');
  await page.locator('#match-center .mc-board').waitFor();
  assert.match(await page.locator('.mc-board').textContent(), /Levante.*2 – 1.*En juego · 74′.*Athletic Club/);
  assert.match(await page.locator('.mc-events').textContent(), /12'.*Carlos Álvarez.*Gol.*30'.*Oihan Sancet.*Tarjeta amarilla.*60'.*Nico Williams.*Sale Iñaki Williams/);
  // General: timeline with the goal and the card on each side, key figures as donuts and the icon row, form.
  assert.equal(await page.locator('.mc-line-row.home .mc-mark.goal').count(), 1);
  assert.equal(await page.locator('.mc-line-row.away .mc-mark.yellow').count(), 1);
  assert.match(await page.locator('.mc-gauges').textContent(), /Posesión58%42%.*Tiros149.*Tiros a puerta63/);
  assert.match(await page.locator('.mc-icons').textContent(), /9.*0.*0.*6.*14.*3.*9.*1.*0.*1/);
  assert.match(await page.locator('.mc-forms').textContent(), /Levante.*VED/);
  assert.match(await page.locator('.mc-facts').textContent(), /LaLiga.*Estadio Ciutat de València.*Valencia, España.*21\.000.*Mateu Lahoz/);
  const screen = await page.evaluate(() => { const v = document.querySelector('.player-screen').getBoundingClientRect(), m = document.querySelector('#match-center').getBoundingClientRect(); return { below: m.top >= v.bottom - 1, ratio: v.width / v.height }; });
  assert.ok(screen.below, 'the match is under the video'); assert.ok(Math.abs(screen.ratio - 16 / 9) < 0.05);
  await page.getByRole('tab', { name: 'Estadísticas' }).click();
  assert.match(await page.locator('.mc-stats').textContent(), /58%.*Posesión.*42%.*14.*Tiros.*9.*6.*Tiros a puerta.*3/);
  await page.getByRole('tab', { name: 'Estadísticas' }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Alineaciones' }).getAttribute('aria-selected'), 'true');
  assert.match(await page.locator('.mc-lineups').textContent(), /Levante4-4-2.*1Andrés Fernández.*Suplentes.*20Roger Brugué.*Athletic Club4-2-3-1.*Iñaki Williams ↓/);
  await page.getByRole('tab', { name: 'H2H' }).click();
  assert.match(await page.locator('.mc-h2h').textContent(), /2025.*LaLiga.*Levante.*1 – 2.*Athletic Club/);
  await page.getByRole('tab', { name: 'General' }).click();
  assert.equal(await page.locator('#player [data-match-id]').count(),0);
  // Scrolling or tapping the match data does not bring back the player controls over the video.
  await page.evaluate(() => document.querySelector('#player').classList.add('idle'));
  const board = await page.locator('#match-center').boundingBox();
  await page.mouse.move(board.x + 20, board.y + 20);
  await page.mouse.move(board.x + 40, board.y + 60);
  await page.getByRole('tab', { name: 'Estadísticas' }).click();
  await page.getByRole('tab', { name: 'General' }).click();
  assert.equal(await page.evaluate(() => document.querySelector('#player').classList.contains('idle')), true, 'the match panel woke the controls');
  // No «En directo» label: the controls take its place, beside the title on wide screens.
  assert.equal(await page.locator('#player .live-pill').count(), 0);
  for(const viewport of [{width:390,height:844},{width:844,height:390},{width:1280,height:900}]){
    await page.setViewportSize(viewport);
    const pos=await page.evaluate(() => {const root=document.querySelector('#player'),bar=root.querySelector('.player-toolbar'),title=root.querySelector('#player-title');return {bar:bar.getBoundingClientRect().toJSON(),title:title.getBoundingClientRect().toJSON(),right:root.querySelector('.player-screen').getBoundingClientRect().right,padding:parseFloat(getComputedStyle(root.querySelector('.player-top')).paddingRight),first:bar.firstElementChild.id};});
    assert.equal(pos.first,'player-viewers');assert.ok(Math.abs(pos.bar.right-(pos.right-pos.padding))<2);
    if (viewport.width > 720) assert.ok(pos.bar.top < pos.title.bottom && pos.bar.left >= pos.title.right, `Controls not beside the title: ${JSON.stringify(pos)}`);
    else assert.ok(pos.bar.top >= pos.title.bottom - 1 && pos.bar.top <= 70, `Controls too low: ${pos.bar.top}`);
  }
  await page.setViewportSize({width:390,height:844});
  scoreFinished = true;
  await page.clock.fastForward(31000);
  await page.locator('.event-card [data-match-id]').getByText('2 – 1 · Finalizado', { exact: true }).waitFor();
  assert.equal(await page.locator('#player-title').textContent(),'Levante vs Athletic');
  // Cards under an open player are not counted again (Firestore quota): they keep their number.
  assert.equal(await page.locator('.event-card .card-viewers b').first().textContent(),'0');
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
  assert.equal(await page.locator('#player-refresh').count(), 0, 'no Refrescar button in the player');
  assert.equal(await page.locator('#player-share svg').count(), 1, 'sharing is an icon');
  assert.equal(await page.locator('.player-bottom #ctl-full').count(), 1, 'full screen is in the bottom controls');
  assert.equal(await page.locator('#match-center').isHidden(), true);
  // Films and series: hidden in the menu until the administrator switches them on.
  const library = { attribution: 'Datos e imágenes de TMDB.', sections: {
    movies: [{ id: 'mavatar', kind: 'movie', title: 'Avatar', year: 2009, file: 'Avatar.mp4', url: 'https://calamarmenciano.com/PELIS/Avatar.mp4', status: 'matched',
      tmdb: { title: 'Avatar', year: 2009, overview: 'En el planeta Pandora…', genres: ['Ciencia ficción'], rating: 7.6, votes: 30000, runtime: 162, cast: [{ name: 'Sam Worthington', character: 'Jake Sully' }], poster: '', backdrop: '' } },
      { id: 'mtorrente', kind: 'movie', title: 'Torrente', year: 1998, file: 'Torrente.mp4', url: 'https://lulustream.com/torrente1998', status: 'matched', tmdb: { title: 'Torrente', genres: ['Comedia'] } }],
    series: [{ id: 'spaco', kind: 'tv', title: 'Los hombres de Paco', folder: 'Los Hombres de Paco', status: 'matched', tmdb: { title: 'Los hombres de Paco', overview: 'Comisaría', genres: ['Comedia'] }, skip: { intro: [30, 90], credits: 40 },
      episodes: [{ id: 'e1001', season: 10, episode: 1, name: 'Vuelta a empezar', url: 'https://www.googleapis.com/drive/v3/files/fE1001?alt=media&key=AIzaTEST' }, { id: 'e1002', season: 10, episode: 2, url: 'https://www.googleapis.com/drive/v3/files/fE1002?alt=media&key=AIzaTEST' }] }],
    documentaries: [] } };
  // The library comes from Firestore (index + parts), published by the admin page; no hosting involved.
  const libraryDocs = { index: { sections: { movies: 1, series: 1, documentaries: 1 }, attribution: library.attribution },
    'movies-0': { items: library.sections.movies }, 'series-0': { items: library.sections.series }, 'documentaries-0': { items: [] } };
  await page.route('https://firestore.googleapis.com/v1/projects/menciamedia/databases/(default)/documents/calamarLibrary/**', route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    return libraryDocs[name] ? route.fulfill({ json: { fields: { json: { stringValue: JSON.stringify(libraryDocs[name]) } } } }) : route.fulfill({ status: 404, json: {} });
  });
  assert.equal(await page.locator('.nav a', { hasText: 'Películas' }).isHidden(), true);
  // While hidden for everyone, the administrator signed in on this browser still sees it, with a note.
  await page.evaluate(() => window.__authWatchers.forEach((w) => w({ email: 'admin@example.com' })));
  await page.waitForFunction(() => !document.querySelector('.nav a[href="#/peliculas"]').hidden);
  await page.evaluate(() => { location.hash = '#/peliculas'; });
  await page.getByText('Oculto para los usuarios: solo lo ves tú, como administrador.', { exact: false }).waitFor();
  await page.evaluate(() => window.__authWatchers.forEach((w) => w({ email: 'otra@example.com' })));
  await page.getByText('Películas no está disponible ahora.').waitFor();
  assert.equal(await page.locator('.nav a', { hasText: 'Películas' }).isHidden(), true);
  await page.evaluate(() => window.__authWatchers.forEach((w) => w(null)));
  await page.goto(base + '/#/admin/biblioteca');
  await page.getByRole('heading', { name: 'Pelis y series', exact: true }).waitFor();
  await page.locator('.library-item').filter({ hasText: 'Avatar (2009)' }).waitFor();
  // The administrator searches TMDB, chooses a title and pastes its LuluStream link; series season by season.
  await page.route('https://api.themoviedb.org/3/**', route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/search/movie') ? { results: [{ id: 76600, title: 'Avatar: El sentido del agua', release_date: '2022-12-14' }] }
      : path.endsWith('/search/tv') ? { results: [{ id: 4500, name: 'Los hombres de Paco', first_air_date: '2005-10-09' }] }
      : path.endsWith('/movie/76600') ? { title: 'Avatar: El sentido del agua', release_date: '2022-12-14', overview: 'Pandora otra vez', genres: [{ name: 'Ciencia ficción' }], credits: { cast: [] } }
      : path.endsWith('/tv/4500') ? { name: 'Los hombres de Paco', first_air_date: '2005-10-09', overview: 'Comisaría', seasons: [{ season_number: 1, name: 'Temporada 1', episode_count: 2 }, { season_number: 2, name: 'Temporada 2', episode_count: 1 }], credits: { cast: [] } }
      : path.endsWith('/tv/4500/season/1') ? { episodes: [{ episode_number: 1, name: 'Piloto' }, { episode_number: 2, name: 'Segundo' }] }
      : path.endsWith('/tv/4500/season/2') ? { episodes: [{ episode_number: 1, name: 'Vuelta' }] } : {};
    return route.fulfill({ json: body });
  });
  await page.getByLabel('Sección', { exact: true }).first().selectOption('movies');
  await page.getByLabel('Buscar en TMDB', { exact: true }).fill('Avatar');
  await page.getByRole('button', { name: 'Buscar en TMDB', exact: true }).click();
  await page.locator('.library-result', { hasText: 'Avatar: El sentido del agua' }).click();
  await page.getByLabel('Enlace del vídeo (LuluStream)', { exact: false }).fill('https://lulustream.com/fld/h9vd4z179z');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText(/^Enlace no válido/).waitFor(); // a folder link is refused
  await page.getByLabel('Enlace del vídeo (LuluStream)', { exact: false }).fill('https://lulustream.com/abc123def456');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByText('Guardado y publicado.', { exact: true }).waitFor();
  let parts = await page.evaluate(() => window.__libraryParts);
  const added = parts.parts['movies-0'].items.find((m) => m.id === 'm76600');
  assert.deepEqual([added.url, added.tmdb.overview], ['https://lulustream.com/abc123def456', 'Pandora otra vez']);
  // A series: the season picker, one link per episode; episodes without a link are left out.
  await page.getByLabel('Sección', { exact: true }).first().selectOption('series');
  await page.getByLabel('Buscar en TMDB', { exact: true }).fill('Paco');
  await page.getByRole('button', { name: 'Buscar en TMDB', exact: true }).click();
  await page.locator('.library-result', { hasText: 'Los hombres de Paco' }).click();
  await page.getByLabel('Enlace del capítulo 1').fill('https://lulustream.com/paco1x01aaaa');
  await page.getByRole('button', { name: 'Guardar temporada', exact: true }).click();
  await page.getByText(/^Temporada 1 guardada y publicada: 1 capítulo con enlace/).waitFor();
  await page.getByLabel('Temporada', { exact: true }).selectOption('2');
  await page.getByLabel('Enlace del capítulo 1').fill('https://lulustream.com/paco2x01bbbb');
  await page.getByRole('button', { name: 'Guardar temporada', exact: true }).click();
  await page.getByText(/^Temporada 2 guardada y publicada/).waitFor();
  // The intro and credits times of the series, for «Saltar intro» and «Siguiente capítulo».
  await page.locator('summary', { hasText: 'Saltar intro y siguiente capítulo' }).click();
  await page.getByLabel('Intro desde', { exact: true }).fill('0:30');
  await page.getByLabel('hasta', { exact: true }).fill('1:45');
  await page.getByLabel('Créditos (duración)', { exact: true }).fill('50');
  await page.getByRole('button', { name: 'Guardar tiempos', exact: true }).click();
  await page.getByText(/^Guardado para toda la serie: intro de 0:30 a 1:45, «Siguiente capítulo» en los últimos 0:50\./).waitFor();
  await page.getByLabel('Tiempos para', { exact: true }).selectOption('season');
  await page.getByLabel('Intro desde', { exact: true }).fill('0:10');
  await page.getByLabel('hasta', { exact: true }).fill('0:05');
  await page.getByRole('button', { name: 'Guardar tiempos', exact: true }).click();
  await page.getByText('La intro tiene que acabar después de empezar.').waitFor();
  await page.getByLabel('hasta', { exact: true }).fill('1:00');
  await page.getByRole('button', { name: 'Guardar tiempos', exact: true }).click();
  await page.getByText(/^Guardado para la temporada 2: intro de 0:10 a 1:00/).waitFor();
  parts = await page.evaluate(() => window.__libraryParts);
  const paco = parts.parts['series-0'].items.find((m) => m.id === 's4500');
  assert.deepEqual(paco.episodes.map((e) => [e.season, e.episode, e.name, e.url]), [[1, 1, 'Piloto', 'https://lulustream.com/paco1x01aaaa'], [2, 1, 'Vuelta', 'https://lulustream.com/paco2x01bbbb']]);
  assert.deepEqual(paco.skip, { intro: [30, 105], credits: 50, seasons: { 2: { intro: [10, 60], credits: 50 } } });
  // Editing later shows the saved links.
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.locator('.library-item', { hasText: 'Avatar: El sentido del agua' }).getByRole('button', { name: 'Editar' }).click();
  assert.equal(await page.getByLabel('Enlace del vídeo (LuluStream)', { exact: false }).inputValue(), 'https://lulustream.com/abc123def456');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  // Or the LuluStream folders are read: Peliculas/ and Series/<Nombre>/Temporada N/, matched in TMDB.
  const luluFolders = { 0: { folders: [{ fld_id: 10, name: 'Películas' }, { fld_id: 20, name: 'Series' }] },
    10: { folders: [], files: [{ file_code: 'avatarlulu12', title: 'Avatar.El.sentido.del.agua.2022.1080p.mkv' }, { file_code: 'nadanada1234', title: 'Zzzz desconocida.mp4' }] },
    20: { folders: [{ fld_id: 21, name: 'Los hombres de Paco' }] }, 21: { folders: [{ fld_id: 22, name: 'Temporada 1' }] },
    22: { folders: [], files: [{ file_code: 'paco1x02cccc', title: 'Los hombres de Paco 1x02.mp4' }] } };
  await page.route('https://api.lulustream.com/api/**', route => route.fulfill({ json: { status: 200, msg: 'OK', result: luluFolders[new URL(route.request().url()).searchParams.get('fld_id')] || {} }, headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.locator('summary', { hasText: 'Configuración' }).click();
  await page.getByLabel('Clave de LuluStream', { exact: true }).fill('clave1234567890');
  await page.getByRole('button', { name: 'Guardar clave de LuluStream', exact: true }).click();
  await page.getByText(/Clave de LuluStream guardada \(privada\)\. Carpetas: Películas, Series/).waitFor();
  await page.getByRole('button', { name: 'Leer carpetas de LuluStream', exact: true }).click();
  await page.getByText(/^Hecho: 1 película o documental y 1 serie \(1 capítulos\) publicados, y 1 sin ficha de TMDB/).waitFor();
  assert.match(await page.locator('.library-scan-report').textContent(), /Zzzz desconocida\.mp4: añadida sin ficha de TMDB/);
  parts = await page.evaluate(() => window.__libraryParts);
  assert.equal(parts.parts['movies-0'].items.find((m) => m.id === 'm76600').url, 'https://lulustream.com/avatarlulu12');
  assert.deepEqual(parts.parts['series-0'].items.find((m) => m.id === 's4500').episodes.map((e) => [e.season, e.episode, e.url]),
    [[1, 1, 'https://lulustream.com/paco1x01aaaa'], [1, 2, 'https://lulustream.com/paco1x02cccc'], [2, 1, 'https://lulustream.com/paco2x01bbbb']]);
  // The film TMDB did not find is in the list anyway; its record is chosen by hand and takes its video.
  assert.equal(parts.parts['movies-0'].items.find((m) => m.id === 'unadanada1234').status, 'unmatched');
  const pendingRow = page.locator('.library-item', { hasText: 'Zzzz desconocida' });
  assert.match(await pendingRow.textContent(), /Sin ficha de TMDB/);
  await pendingRow.getByRole('button', { name: 'Buscar en TMDB', exact: true }).click();
  assert.equal(await page.getByLabel('Buscar su ficha en TMDB', { exact: true }).inputValue(), 'Zzzz desconocida');
  await page.locator('.library-editor .library-result', { hasText: 'Avatar: El sentido del agua' }).click();
  await page.getByText(/«Zzzz desconocida» es ahora «Avatar: El sentido del agua», con su vídeo/).waitFor();
  parts = await page.evaluate(() => window.__libraryParts);
  assert.equal(parts.parts['movies-0'].items.some((m) => m.id === 'unadanada1234'), false);
  assert.equal(parts.parts['movies-0'].items.find((m) => m.id === 'm76600').url, 'https://lulustream.com/nadanada1234');
  assert.equal(await page.getByLabel('Enlace del vídeo (LuluStream)', { exact: false }).inputValue(), 'https://lulustream.com/nadanada1234');
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByLabel('Mostrar Películas, Series y Documentales a los usuarios (web y app)').check();
  await page.waitForFunction(() => window.__published.libraryVisible === true);
  await page.goto(base + '/#/');
  await page.locator('.nav a', { hasText: 'Películas' }).click();
  // Category drop-down (TMDB genres of the section) next to the section search; no channels search here.
  await page.locator('.poster-card').first().waitFor();
  assert.equal(await page.locator('#search').isHidden(), true, 'the channels and events search is hidden in the library');
  await page.getByLabel('Categoría', { exact: true }).selectOption('Ciencia ficción');
  assert.equal(await page.locator('.poster-card').count(), 1);
  await page.getByLabel('Categoría', { exact: true }).selectOption('');
  // A LuluStream video always plays in our player, through the hosting (LuluStream only serves who opened
  // its page). hls.js (from its CDN, blocked here) is replaced by a stand-in whose list fails, to see that a
  // failure shows our message with «Reintentar» and never LuluStream's player.
  await page.evaluate(() => {
    window.Hls = class {
      static isSupported() { return true; }
      static Events = { ERROR: 'hlsError' };
      on(name, handler) { if (name === 'hlsError') this.failed = handler; }
      loadSource(url) { window.__hlsSource = url; setTimeout(() => this.failed?.('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 502 }, url }), 50); }
      attachMedia() {} destroy() {} stopLoad() {} startLoad() {}
      get levels() { return []; }
    };
  });
  await page.locator('.poster-card', { hasText: 'Torrente' }).click();
  await page.getByRole('button', { name: '▶ Reproducir', exact: true }).click();
  await page.locator('#player-status').getByRole('button', { name: '↻ Reintentar' }).waitFor();
  assert.equal(await page.evaluate(() => window.__hlsSource), 'https://calamarmenciano.com/calamar-lulu.php?code=torrente1998&hls=1');
  assert.equal(await page.locator('#player iframe').count(), 0);
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.locator('.nav a', { hasText: 'Películas' }).click();
  await page.locator('.poster-card').first().waitFor();
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
  assert.equal(await page.locator('#player .live-pill').count(), 0);
  assert.equal(await page.evaluate(() => document.fullscreenElement?.id), 'player');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/peliculas/mavatar');
  await page.locator('.nav a', { hasText: 'Series' }).click();
  await page.locator('.poster-card', { hasText: 'Los hombres de Paco' }).click();
  await page.getByRole('button', { name: 'Temporada 10', exact: true }).waitFor();
  // An episode opens its own page (its name, or «Capítulo N» without one, and synopsis) with the play button.
  assert.equal(await page.locator('.episode b').nth(1).textContent(), 'Capítulo 2');
  await page.locator('.episode', { hasText: 'Vuelta a empezar' }).click();
  await page.getByRole('heading', { name: 'Vuelta a empezar', exact: true }).waitFor();
  assert.ok(page.url().endsWith('#/series/spaco/capitulo/e1001'));
  assert.equal(await page.locator('#player').isHidden(), true);
  await page.getByRole('button', { name: '▶ Reproducir', exact: true }).click();
  await page.locator('#player:not([hidden])').waitFor();
  assert.equal(await page.locator('#player-title').textContent(), 'Los hombres de Paco · T10 · Vuelta a empezar');
  assert.equal(await page.locator('#player-share').isHidden(), true, 'films and episodes are not shared');
  // «Saltar intro» during the series' intro; «Siguiente capítulo» with its count during the credits.
  await page.evaluate(() => { const v = document.getElementById('video'); let t = 40;
    Object.defineProperty(v, 'currentTime', { configurable: true, get: () => t, set: (x) => { t = x; } });
    Object.defineProperty(v, 'duration', { configurable: true, get: () => 2400 });
    v.dispatchEvent(new Event('timeupdate')); });
  await page.getByRole('button', { name: 'Saltar intro', exact: true }).click();
  assert.equal(await page.evaluate(() => document.getElementById('video').currentTime), 90);
  assert.equal(await page.locator('#player-skip-intro').isHidden(), true);
  await page.evaluate(() => { const v = document.getElementById('video'); v.currentTime = 2370; v.dispatchEvent(new Event('timeupdate')); });
  assert.equal(await page.locator('#player-next').textContent(), 'Siguiente capítulo · 10');
  await page.getByRole('button', { name: 'Seguir viendo los créditos' }).click();
  assert.equal(await page.locator('#player-next').isHidden(), true);
  await page.evaluate(() => { const v = document.getElementById('video'); delete v.currentTime; delete v.duration; });
  // When it ends the next episode starts by itself.
  await page.evaluate(() => document.getElementById('video').dispatchEvent(new Event('ended')));
  await page.waitForFunction(() => document.getElementById('player-title').textContent === 'Los hombres de Paco · T10 · Capítulo 2');
  assert.ok(page.url().endsWith('#/series/spaco/ver/e1002'));
  await page.waitForFunction(() => document.getElementById('video').src === 'https://www.googleapis.com/drive/v3/files/fE1002?alt=media&key=AIzaTEST');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  // «Continuar viendo» heads the home page and opens the film where it was left.
  await page.evaluate(() => localStorage.setItem('calamar-progress-v1', JSON.stringify({ mavatar: { key: 'mavatar', page: 'peliculas', item: 'mavatar', episode: '',
    name: 'Avatar', sub: '2009', image: '', position: 1800, duration: 9720, at: Date.now() } })));
  await page.goto(base + '/#/inicio');
  await page.getByRole('heading', { name: 'Continuar viendo', exact: true }).waitFor();
  assert.equal(await page.locator('#search').isVisible(), true, 'the channels and events search is back outside the library');
  assert.equal(await page.locator('main h2').first().textContent(), 'Continuar viendo');
  assert.ok(await page.evaluate(() => { const slider = document.querySelector('.highlight-slider'), row = document.querySelector('.continue-rail');
    return !!slider && !!(slider.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING); }), 'Continuar viendo comes under the featured slider');
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
  // Signing in the app from a phone: the QR opens the page with the app's key and code; the short link only the key.
  await page.goto(base + '/#/tv/K7Q2/AB3D');
  await page.getByRole('heading', { name: 'Iniciar sesión en la app', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Código que muestra la app').inputValue(), 'AB3D');
  await page.getByRole('button', { name: 'Confirmar e iniciar sesión con Google', exact: true }).click();
  await page.getByText('Esperando a la app…').waitFor();
  assert.equal(await page.evaluate(() => window.__deviceLogin), 'K7Q2AB3D');
  await page.evaluate(() => window.__deviceUsed());
  await page.getByText('✓ Listo: la app ya tiene la sesión iniciada.').waitFor();
  await page.goto(base + '/#/tv/k7q2');
  await page.getByLabel('Código que muestra la app').fill('ab-3');
  await page.getByRole('button', { name: 'Confirmar e iniciar sesión con Google', exact: true }).click();
  await page.getByText('Escribe los 4 caracteres que muestra la app (letras y números).').waitFor();
  await page.getByLabel('Código que muestra la app').fill('xy9z');
  await page.getByRole('button', { name: 'Confirmar e iniciar sesión con Google', exact: true }).click();
  await page.waitForFunction(() => window.__deviceLogin === 'K7Q2XY9Z');
  await page.goto(base + '/#/tv/zz');
  await page.getByText(/Este enlace no es válido/).waitFor();
  // Importar competición: ESPN's calendar (mocked) becomes the league, its teams and the week's matches.
  const crestPng = await readFile(resolve(root, 'assets/favicon-192.png')).catch(() => Buffer.alloc(0));
  await page.route('https://a.espncdn.com/**', route => route.fulfill({ contentType: 'image/png', body: crestPng }));
  await page.route('https://example.com/fondo.jpg', route => route.fulfill({ contentType: 'image/png', body: crestPng }));
  const espnTeam = (id, name) => ({ id, displayName: name, logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` });
  const espnMatch = (id, date, home, away, done = false) => ({ id, date, season: { year: 2026 }, competitions: [{ status: { type: { completed: done } },
    competitors: [{ homeAway: 'home', team: home }, { homeAway: 'away', team: away }] }] });
  const [rm, fcb, atm, sev] = [espnTeam('86', 'Real Madrid'), espnTeam('83', 'Barcelona'), espnTeam('1068', 'Atlético Madrid'), espnTeam('243', 'Sevilla')];
  await page.route('https://site.api.espn.com/apis/site/v2/sports/soccer/esp.1/**', route => {
    const url = route.request().url();
    const body = !url.includes('dates=') ? { leagues: [{ name: 'Spanish LALIGA', season: { year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z' }, logos: [{ href: 'https://a.espncdn.com/l.png', rel: ['default'] }] }], events: [] }
      : url.includes('dates=2026') ? { events: [espnMatch('900', '2026-11-29T20:00Z', fcb, rm, true), espnMatch('901', '2026-12-01T20:00Z', rm, fcb),
        espnMatch('902', '2026-12-06T20:00Z', atm, sev), espnMatch('903', '2026-12-08T20:00Z', sev, rm)] } : { events: [] };
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto(base + '/#/admin/ligas');
  await page.getByLabel('O elige la competición', { exact: true }).selectOption('esp.1');
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForFunction(() => window.__published.fixtures?.length === 3);
  const imported = await page.evaluate(() => window.__published);
  const laliga = imported.leagues.find(l => l.espn === 'esp.1');
  assert.equal(laliga.season, '2026/2027');
  assert.deepEqual(imported.fixtures.map(f => f.matchId), ['901', '902', '903']);
  await page.getByText(/LaLiga 2026\/2027: 3 partidos por jugar importados/).waitFor();
  await page.goto(base + `/#/admin/ligas/${encodeURIComponent(laliga.id)}`);
  await page.getByLabel('O enlace HTTPS del fondo', { exact: true }).fill('https://example.com/fondo.jpg');
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction(() => window.__published.leagues.some(l => l.background === 'https://example.com/fondo.jpg'));
  const atleti = imported.fixtures.find(f => f.matchId === '902');
  await page.goto(base + `/#/admin/editar-evento/${encodeURIComponent(atleti.id)}`);
  await page.getByText('Sin canal: los usuarios verán «Canal por confirmar».').waitFor();
  await page.locator('.channel-options button').filter({ hasText: 'Sports One' }).click();
  await page.getByRole('button', { name: 'Guardar y publicar', exact: true }).click();
  await page.waitForFunction((id) => window.__published.fixtures.find(f => f.id === id)?.channelId === 'sport-one', atleti.id);
  const savedFixture = await page.evaluate((id) => window.__published.fixtures.find(f => f.id === id), atleti.id);
  assert.equal(savedFixture.name, undefined, 'the name keeps following the teams');
  assert.equal(savedFixture.matchUrl, undefined, 'the Google link keeps following the teams');
  await page.goto(base + '/#/');
  const weekRow = page.locator('.event-card');
  await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).waitFor();
  await weekRow.filter({ hasText: 'Atlético Madrid vs Sevilla' }).waitFor();
  assert.equal(await weekRow.filter({ hasText: 'Sevilla vs Real Madrid' }).count(), 0, 'next week stays hidden');
  assert.match(await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).innerText(), /Canal por confirmar/);
  assert.equal(await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).locator('.event-generic img.crest').count(), 2);
  assert.match(await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).locator('.event-generic').getAttribute('style'), /fondo\.jpg/);
  if (process.env.CALAMAR_SHOTS) await page.screenshot({ path: `${process.env.CALAMAR_SHOTS}/competition-home.png`, fullPage: true });
  await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).click();
  await page.getByText('Canal por confirmar. El partido se verá aquí en cuanto tenga canal.').waitFor();
  assert.equal(await page.locator('#player').evaluate(n => n.classList.contains('with-match')), true);
  if (process.env.CALAMAR_SHOTS) await page.screenshot({ path: `${process.env.CALAMAR_SHOTS}/competition-pending.png` });
  await page.getByRole('button', { name: 'Cerrar', exact: false }).first().click().catch(() => {});
  // Once the last match of the week is over, the next week's appear.
  await page.clock.setFixedTime(new Date('2026-12-07T01:00:00Z'));
  await page.goto(base + '/#/canales'); await page.goto(base + '/#/');
  await weekRow.filter({ hasText: 'Sevilla vs Real Madrid' }).waitFor();
  assert.equal(await weekRow.filter({ hasText: 'Real Madrid vs Barcelona' }).count(), 0);
  // A shared link opened while the live catalog is still arriving waits for it instead of saying it does not exist.
  await page.evaluate(() => sessionStorage.setItem('slowCatalog', '1'));
  await page.goto(base + '/?slow=1#/evento/sevilla-vs-real-madrid');
  await page.getByText('Abriendo el evento…').waitFor();
  assert.equal(await page.getByText(/No existe el evento/).count(), 0);
  await page.locator('#player-title').getByText('Sevilla vs Real Madrid', { exact: true }).waitFor();
  await page.evaluate(() => sessionStorage.removeItem('slowCatalog'));
  // A player page (read by the hosting) that keeps failing: the web asks the hosting again, from another
  // of the page's videos (intento=1, 2, 3), before showing the failure.
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('catalog'));
    saved.channels.push({ id: 'pagina', name: 'Canal Página', group: 'Deportes', streams: ['https://player.example/canal/uno'] });
    sessionStorage.setItem('catalog', JSON.stringify(saved));
  });
  await page.addInitScript(() => {
    window.__hlsSources = [];
    window.Hls = class {
      static isSupported() { return true; }
      static Events = { ERROR: 'hlsError' };
      on(name, handler) { if (name === 'hlsError') this.failed = handler; }
      loadSource(url) { window.__hlsSources.push(url); setTimeout(() => this.failed?.('hlsError', { fatal: true, type: 'networkError', details: 'manifestLoadError', response: { code: 502 }, url }), 50); }
      attachMedia() {} destroy() {} stopLoad() {} startLoad() {}
      get levels() { return []; }
    };
  });
  await page.goto(base + '/?pagina=1#/canal/canal-pagina');
  await page.getByText('La emisión se ha cortado. Reconectando…').waitFor();
  await page.clock.runFor(10000);
  await page.locator('#player-status').getByRole('button', { name: '↻ Reintentar' }).waitFor();
  const asked = await page.evaluate(() => window.__hlsSources);
  const relay = 'https://calamarmenciano.com/calamar-player.php?page=https%3A%2F%2Fplayer.example%2Fcanal%2Funo&hls=1';
  assert.deepEqual(asked, [relay, `${relay}&intento=1`, `${relay}&intento=2`, `${relay}&intento=3`]);
  assert.match(await page.locator('#player-status').innerText(), /ninguna de sus fuentes funciona/);
  // zicotv: its own player inside ours, straight from zicotv; nothing goes through the hosting.
  await page.route('https://zicotv.cc/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Reproductor de zicotv</p>' }));
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('catalog'));
    saved.channels.push({ id: 'zico', name: 'Canal Zico', group: 'Deportes', streams: ['https://zicotv.cc/api/player/1'] });
    sessionStorage.setItem('catalog', JSON.stringify(saved));
  });
  await page.evaluate(() => { window.__hlsSources = []; });
  await page.goto(base + '/?zico=1#/canal/canal-zico');
  await page.locator('#player-frame').waitFor();
  assert.equal(await page.locator('#player-frame').getAttribute('src'), 'https://zicotv.cc/api/player/1');
  assert.equal(await page.evaluate(() => document.querySelector('#player').classList.contains('framed')), true);
  assert.equal(await page.frameLocator('#player-frame').getByText('Reproductor de zicotv').count(), 1);
  assert.equal(await page.locator('#player-close').isVisible(), true);
  assert.deepEqual(await page.evaluate(() => window.__hlsSources), []);
  await page.locator('#player-close').click();
  assert.equal(await page.locator('#player-frame').count(), 0);
  assert.deepEqual(errors, []);
  console.log('UI verificada: crear evento, subir portada, buscar canal, fecha antes del inicio, carrusel automático y deslizable, espectadores y visitas, estadísticas, portada solo con eventos por liga, importar competición con jornadas de la semana, fondo de liga con escudos y «Canal por confirmar», multipantalla, categorías con orden arrastrable, nombre y color, pelis y series, editar y retirar eventos asociados; buscador bajo cabecera.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
