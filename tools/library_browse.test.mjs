import test from 'node:test';
import assert from 'node:assert/strict';
import { browseRows, todaysPicks, dailyLuck, halloweenOn, horrorTitles, isSpanish, LIBRARY_SECTIONS } from '../web/library.js';
import { countriesOf } from '../web/library-tmdb.js';

const movies = LIBRARY_SECTIONS[0], docs = LIBRARY_SECTIONS[2];
const now = Date.parse('2026-10-28T12:00:00Z');
const item = (id, tmdb = {}, extra = {}) => ({ id, kind: 'movie', ...extra, tmdb: { id: id.length, genres: [], providers: ['Netflix'], ...tmdb } });

test('a section page is a stack of Netflix-style rows in a fixed order', () => {
  const items = [
    item('torrente', { genres: ['Comedia'], countries: ['ES'] }, { trend: 2, addedAt: '2026-10-01' }),
    item('weapons', { genres: ['Terror', 'Misterio'], countries: ['US'], providers: [] }, { trend: 1, addedAt: '2026-10-20' }),
    item('kraven', { genres: ['Acción', 'Ciencia ficción'], countries: ['US'] }),
    item('ozark', { genres: ['Western'], countries: ['US'] }),
  ];
  const rows = browseRows(movies, items, { now, name: 'Yuanyo' });
  assert.deepEqual(rows.map((r) => r.title), ['Películas españolas', 'Recomendaciones de hoy para ti', 'Las 2 películas más populares de la semana',
    'Películas de terror', 'Solo en Calamar TV', 'Seguir viendo para Yuanyo', 'Ciencia ficción y fantasía', '¿Quieres echarte unas risas?',
    'Novedades en Calamar TV', 'Acción a tope', 'Misterios por resolver', 'Películas de western']);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(by.top.items.map((i) => i.id), ['weapons', 'torrente']);
  assert.equal(by.top.kind, 'top'); assert.equal(by.only.kind, 'big'); assert.equal(by.continue.kind, 'continue');
  assert.deepEqual(by.only.items.map((i) => i.id), ['weapons'], 'on no platform in Spain');
  assert.deepEqual(by.new.items.map((i) => i.id), ['weapons', 'torrente']);
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
