import test from 'node:test';
import assert from 'node:assert/strict';
import { rankTop, libraryFeatured, libraryTop, itemLine, itemPath, LIBRARY_SECTIONS, TOP_SIZE } from '../web/library.js';

const film = (n, extra = {}) => ({ id: `m${n}`, kind: 'movie', title: `Peli ${n}`, status: 'matched', tmdb: { id: n, title: `Peli ${n}`, year: 2020 + (n % 5), genres: ['Drama', 'Comedia', 'Acción'], rating: 7.4 }, ...extra });
const show = (n, extra = {}) => ({ id: `s${n}`, kind: 'tv', title: `Serie ${n}`, status: 'matched', tmdb: { id: n, title: `Serie ${n}` }, episodes: [], ...extra });

test('the top puts TMDB trending titles first, in its order, then the rest by popularity', () => {
  const sections = { movies: [film(1), film(2), film(3), { ...film(4), status: 'unmatched' }], series: [show(1)], documentaries: [] };
  const ranked = rankTop(sections, [{ id: 3, kind: 'movie' }, { id: 1, kind: 'tv' }, { id: 99, kind: 'movie' }], { 'movie:1': 5, 'movie:2': 50, 'movie:4': 999 });
  const order = libraryTop({ sections: ranked }).map(({ item }) => item.id);
  assert.deepEqual(order, ['m3', 's1', 'm2', 'm1']);
  assert.equal(ranked.movies[3].trend, undefined); // without a TMDB record it is never ranked
});

test('only the first 10 keep a place, and an old place is cleared', () => {
  const movies = Array.from({ length: 14 }, (_, i) => film(i + 1, { trend: 14 - i }));
  const ranked = rankTop({ movies, series: [], documentaries: [] }, [], Object.fromEntries(movies.map((m, i) => [`movie:${i + 1}`, i])));
  assert.equal(ranked.movies.filter((m) => m.trend).length, TOP_SIZE);
  assert.equal(ranked.movies[13].trend, 1);
  assert.equal(ranked.movies[0].trend, undefined);
});

test('titles «En portada» keep the order in which they were marked', () => {
  const library = { sections: { movies: [film(1, { featured: 300 }), film(2)], series: [show(5, { featured: 100 })], documentaries: [] } };
  const featured = libraryFeatured(library);
  assert.deepEqual(featured.map(({ item }) => item.id), ['s5', 'm1']);
  assert.equal(featured[0].section.key, 'series');
  assert.deepEqual(libraryFeatured(null), []);
});

test('the line under a featured title and its page', () => {
  const movies = LIBRARY_SECTIONS[0];
  assert.equal(itemLine(movies, film(1)), 'Película · 2021 · Drama, Comedia · ★ 7,4');
  assert.equal(itemPath(movies, film(1)), '#/peliculas/m1');
});
