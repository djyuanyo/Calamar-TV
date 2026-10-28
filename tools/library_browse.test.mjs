import test from 'node:test';
import assert from 'node:assert/strict';
import { browseRows, todaysPicks, dailyLuck, halloweenOn, horrorTitles, isSpanish, LIBRARY_SECTIONS, hasNewEpisode, posterLabel, freshTitles, heroTitles, platformsOf, platformRows } from '../web/library.js';
import { countriesOf, providerLogosOf, stampAdded } from '../web/library-tmdb.js';

const movies = LIBRARY_SECTIONS[0], docs = LIBRARY_SECTIONS[2];
const now = Date.parse('2026-10-28T12:00:00Z');
const item = (id, tmdb = {}, extra = {}) => ({ id, kind: 'movie', ...extra, tmdb: { id: id.length, genres: [], providers: ['Netflix'], ...tmdb } });

test('a section page is a stack of Netflix-style rows in a fixed order', () => {
  const items = [
    item('torrente', { genres: ['Comedia'], countries: ['ES'] }, { trend: 2, addedAt: '2026-10-01' }),
    item('weapons', { genres: ['Terror', 'Misterio'], countries: ['US'], providers: [], year: 2026 }, { trend: 1, addedAt: '2026-10-20' }),
    item('kraven', { genres: ['Acción', 'Ciencia ficción'], countries: ['US'] }),
    item('ozark', { genres: ['Western'], countries: ['US'] }),
  ];
  const rows = browseRows(movies, items, { now, name: 'Yuanyo' });
  assert.deepEqual(rows.map((r) => r.title), ['Películas españolas', 'Recomendaciones de hoy para ti', 'Las 2 películas más populares de la semana',
    'Películas de terror', 'Novedades en Calamar TV', 'Seguir viendo para Yuanyo', 'Ciencia ficción y fantasía', '¿Quieres echarte unas risas?',
    'Acción a tope', 'Misterios por resolver', 'Películas de western']);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(by.top.items.map((i) => i.id), ['weapons', 'torrente']);
  assert.equal(by.top.kind, 'top'); assert.equal(by.new.kind, 'big'); assert.equal(by.continue.kind, 'continue');
  assert.deepEqual(by.new.items.map((i) => i.id), ['weapons'], 'only the new arrivals, with the large posters');
});

test('empty rows are left out and documentaries have no top', () => {
  const rows = browseRows(docs, [item('d1', { genres: ['Documental'] })], { now });
  assert.deepEqual(rows.map((r) => r.title), ['Recomendaciones de hoy para ti', 'Seguir viendo']);
});

test('Spanish titles go by production country, or by language without one', () => {
  assert.equal(isSpanish(item('a', { countries: ['ES', 'FR'] })), true);
  assert.equal(isSpanish(item('b', { countries: ['MX'], language: 'es' })), false);
  assert.equal(isSpanish(item('c', { language: 'es' })), true);
  assert.deepEqual(countriesOf({ production_countries: [{ iso_3166_1: 'ES' }], origin_country: ['ES', 'AR', 'x'] }), ['ES', 'AR']);
});

test('today\'s picks change every day, put the genres already watched first and skip what was started', () => {
  const items = [item('a', { genres: ['Terror'] }), item('b', { genres: ['Comedia'] }), item('c', { genres: ['Terror'] }), item('d', { genres: ['Drama'] })];
  const picks = todaysPicks(items, ['a'], '2026-10-28');
  assert.equal(picks[0].id, 'c'); assert.ok(!picks.some((i) => i.id === 'a'));
  assert.notEqual(dailyLuck('2026-10-28', 'b'), dailyLuck('2026-10-29', 'b'));
  assert.equal(dailyLuck('2026-10-28', 'b'), dailyLuck('2026-10-28', 'b'));
});

test('Especial Halloween runs from 1 October to 2 November (Madrid) with every horror title', () => {
  assert.equal(halloweenOn(Date.parse('2026-09-30T12:00:00Z')), false);
  assert.equal(halloweenOn(Date.parse('2026-10-01T08:00:00Z')), true);
  assert.equal(halloweenOn(Date.parse('2026-11-02T22:30:00Z')), true, 'still 2 November in Madrid until 23:00 UTC');
  assert.equal(halloweenOn(Date.parse('2026-11-02T23:30:00Z')), false);
  const library = { sections: { movies: [item('m', { genres: ['Terror'] }), item('n', { genres: ['Drama'] })], series: [item('s', { genres: ['Terror'] }, { kind: 'tv' })] } };
  assert.deepEqual(horrorTitles(library).map(({ section, item: i }) => `${section.key}:${i.id}`), ['movies:m', 'series:s']);
});

const series = (id, addedAt, episodes, tmdb = {}) => ({ id, kind: 'tv', addedAt, episodes: episodes.map((day, i) => ({ id: `${id}${i}`, season: 1, episode: i + 1, ...(day ? { addedAt: day } : {}) })),
  tmdb: { id: 9, genres: ['Drama'], providers: ['Netflix'], year: 2019, ...tmdb } });

test('a series that got an episode in the last two weeks says «Nuevo episodio»', () => {
  assert.equal(hasNewEpisode(series('a', '2026-01-10', ['2026-01-10', '2026-10-25']), now), true);
  assert.equal(posterLabel(series('a', '2026-01-10', ['2026-01-10', '2026-10-25']), now), 'Nuevo episodio');
  assert.equal(hasNewEpisode(series('b', '2026-01-10', ['2026-01-10', '2026-10-01']), now), false, 'more than two weeks ago');
  assert.equal(hasNewEpisode(series('c', '2026-10-25', ['2026-10-25', '2026-10-25']), now), false, 'the series itself just arrived');
  assert.equal(hasNewEpisode(series('d', '2026-01-10', ['', '']), now), false, 'episodes from before the dates were kept');
  const fresh = freshTitles([item('m', { year: 2026 }, { addedAt: '2026-10-20' }), series('a', '2026-01-10', ['2026-01-10', '2026-10-25']), item('old', { year: 2001 }, { addedAt: '2026-10-27' })], now);
  assert.deepEqual(fresh.map((i) => i.id), ['a', 'm']);
});

test('episodes keep the day they arrived and new ones get today', () => {
  const before = { series: [{ id: 's', addedAt: '2026-01-10', episodes: [{ id: 'e1', addedAt: '2026-01-10' }, { id: 'e2' }] }] };
  const next = { series: [{ id: 's', episodes: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }] }, { id: 'new', episodes: [{ id: 'n1' }] }] };
  const out = stampAdded(next, before, '2026-10-28').series;
  assert.deepEqual(out[0].episodes, [{ id: 'e1', addedAt: '2026-01-10' }, { id: 'e2' }, { id: 'e3', addedAt: '2026-10-28' }]);
  assert.equal(out[0].addedAt, '2026-01-10');
  assert.deepEqual(out[1], { id: 'new', episodes: [{ id: 'n1' }], addedAt: '2026-10-28' }, 'a new series arrives whole, without «Nuevo episodio»');
});

test('the slider shows what is new, then the weekly top', () => {
  const items = [item('top2', {}, { trend: 2 }), item('new', { year: 2026 }, { addedAt: '2026-10-20' }), item('top1', {}, { trend: 1 }), item('other', { rating: 9, poster: 'https://x/p.jpg' })];
  assert.deepEqual(heroTitles(items, now).map((i) => i.id), ['new', 'top1', 'top2']);
  assert.deepEqual(heroTitles([item('a', { rating: 5, poster: 'p' }), item('b', { rating: 8, poster: 'p' })], now).map((i) => i.id), ['b', 'a'], 'without news or top, the best rated');
});

test('platform buttons and the platform page with every section together', () => {
  const logos = { Netflix: 'https://image.tmdb.org/t/p/w154/n.jpg' };
  const library = { sections: {
    movies: [item('m1', { providers: ['Netflix', 'Disney Plus'], logos, genres: ['Terror'] }), item('m2', { providers: ['Disney Plus'], genres: ['Comedia'] })],
    series: [{ ...series('s1', '2026-01-10', ['2026-01-10']), tmdb: { id: 3, providers: ['Netflix'], genres: ['Drama'] } }] } };
  assert.deepEqual(platformsOf(library.sections.movies).map((p) => [p.name, p.count, p.logo]), [['Disney Plus', 2, ''], ['Netflix', 1, logos.Netflix]]);
  const { all, rows } = platformRows(library, 'Netflix', now);
  assert.equal(all.length, 2);
  assert.deepEqual(rows.map((r) => r.title), ['En primer plano', 'Películas', 'Series', 'Terror', 'Dramas que enganchan']);
  assert.deepEqual(providerLogosOf({ 'watch/providers': { results: { ES: { flatrate: [{ provider_name: 'Netflix', logo_path: '/n.jpg' }, { provider_name: 'Bad', logo_path: 'javascript:x' }] } } } }),
    { Netflix: 'https://image.tmdb.org/t/p/w154/n.jpg' });
});

import { luluvidoLinks } from '../web/library.js';
test('LuluStream links move to luluvido.com, other links stay', () => {
  const { sections, changed } = luluvidoLinks({
    movies: [{ id: 'a', url: 'https://lulustream.com/abc123def456' }, { id: 'b', url: 'https://luluvido.com/xyz987654321' }, { id: 'c', url: 'https://calamarmenciano.com/PELIS/C.mp4' }],
    series: [{ id: 's', episodes: [{ id: 'e1', url: 'https://www.luluvdo.com/d/ep1code12345.html' }, { id: 'e2', url: 'https://lulustream.com/e/ep2code12345' }] }] });
  assert.equal(changed, 3);
  assert.deepEqual(sections.movies.map((m) => m.url), ['https://luluvido.com/abc123def456', 'https://luluvido.com/xyz987654321', 'https://calamarmenciano.com/PELIS/C.mp4']);
  assert.deepEqual(sections.series[0].episodes.map((e) => e.url), ['https://luluvido.com/ep1code12345', 'https://luluvido.com/ep2code12345']);
});

import { validateCatalog } from '../web/shared-catalog.js';
test('the platforms set in the admin page go first in their order, with their own logo, and hidden ones are left out', () => {
  const items = [item('a', { providers: ['Netflix', 'Max', 'Filmin'], logos: { Netflix: 'https://t/n.jpg', Max: 'https://t/m.jpg' } }), item('b', { providers: ['Netflix', 'Max'] })];
  const settings = [{ name: 'Filmin', logo: 'https://mio/filmin.png' }, { name: 'Max', hidden: true }];
  assert.deepEqual(platformsOf(items, settings).map((p) => [p.name, p.logo]), [['Filmin', 'https://mio/filmin.png'], ['Netflix', 'https://t/n.jpg']]);
  const base = { channels: [], featured: [], hidden: [] };
  assert.doesNotThrow(() => validateCatalog({ ...base, platforms: settings }));
  assert.throws(() => validateCatalog({ ...base, platforms: [{ name: 'X' }, { name: 'X' }] }), /plataforma/);
  assert.throws(() => validateCatalog({ ...base, platforms: [{ name: 'X', logo: 'javascript:alert(1)' }] }), /plataforma/);
});

import { similarTitles, resumeEpisode } from '../web/library.js';
import { trailerOf, creatorsOf } from '../web/library-tmdb.js';
test('the title page: trailer in Spanish, creators, similar titles and the episode to play', () => {
  const v = (key, extra) => ({ key, site: 'YouTube', iso_639_1: 'es', type: 'Trailer', ...extra });
  assert.equal(trailerOf({ videos: { results: [v('teaserTeaser', { type: 'Teaser', iso_3166_1: 'ES' }), v('latinoLatin', { iso_3166_1: 'MX' }), v('espanaSpain', { iso_3166_1: 'ES' })] } }), 'espanaSpain');
  assert.equal(trailerOf({ videos: { results: [v('englishOnly', { iso_639_1: 'en' }), v('bad', {})] } }), '');
  assert.deepEqual(creatorsOf({ created_by: [{ name: 'Said Chamie' }, { name: 'Claudia Sánchez' }] }), ['Said Chamie', 'Claudia Sánchez']);
  assert.deepEqual(creatorsOf({ credits: { crew: [{ job: 'Director', name: 'James Cameron' }, { job: 'Writer', name: 'X' }] } }), ['James Cameron']);
  const library = { sections: { series: [item('a', { genres: ['Drama', 'Crimen'] }), item('b', { genres: ['Drama', 'Crimen'], rating: 5 }), item('c', { genres: ['Drama'], rating: 9 }), item('d', { genres: ['Western'] })] } };
  assert.deepEqual(similarTitles(library, LIBRARY_SECTIONS[1], library.sections.series[0]).map((i) => i.id), ['b', 'c']);
  const show = { episodes: [{ id: 'e2', season: 1, episode: 2 }, { id: 'e1', season: 1, episode: 1 }, { id: 'f1', season: 2, episode: 1 }] };
  assert.equal(resumeEpisode(show).id, 'e1');
  assert.equal(resumeEpisode(show, (id) => ({ e2: { at: 5 }, f1: { at: 9 } })[id] || null).id, 'f1');
});
