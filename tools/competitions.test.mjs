import assert from 'node:assert/strict';
import test from 'node:test';
import { detectCompetition, assignRounds, parseSeason, applySeason, fixtureEvent, weekFixtures, madridWeek, seasonName, competitionFromLink, fetchSeason } from '../web/competitions.js';
import { events, eventSlugs, merge } from '../web/catalog.js';
import { validateCatalog } from '../web/shared-catalog.js';

const DAY = 86400000;
const team = (id, name) => ({ id, displayName: name, logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` });
const espnEvent = (id, date, home, away, { year = 2026, done = false } = {}) => ({ id, date, season: { year },
  competitions: [{ status: { type: { completed: done, name: done ? 'STATUS_FULL_TIME' : 'STATUS_SCHEDULED' } },
    competitors: [{ homeAway: 'home', team: home }, { homeAway: 'away', team: away }] }] });
const league = { leagues: [{ name: 'Spanish LALIGA', season: { year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z' }, logos: [{ href: 'https://a.espncdn.com/l.png', rel: ['full', 'default'] }] }] };
const [rm, fcb, atm, sev] = [team('86', 'Real Madrid'), team('83', 'Barcelona'), team('1068', 'Atlético Madrid'), team('243', 'Sevilla')];

test('the competition comes from the words of the Google search', () => {
  assert.equal(detectCompetition('LaLiga').slug, 'esp.1');
  assert.equal(detectCompetition('LaLiga Hypermotion').slug, 'esp.2');
  // The Spanish names of Google's share links («Copa de la Liga de Inglaterra» is the Carabao Cup).
  assert.equal(detectCompetition('Copa de la Liga de Inglaterra').slug, 'eng.league_cup');
  assert.equal(detectCompetition('Copa de Inglaterra').slug, 'eng.fa');
  assert.equal(detectCompetition('Primera División de Inglaterra').slug, 'eng.1');
  assert.equal(detectCompetition('Primera División de España').slug, 'esp.1');
  assert.equal(detectCompetition('Liga de Campeones de la UEFA').slug, 'uefa.champions');
  assert.equal(detectCompetition('Premier League clasificación').slug, 'eng.1');
  assert.equal(detectCompetition('receta de paella'), null);
  assert.equal(seasonName({ year: 2026, startDate: '2026-06-01T04:00Z', endDate: '2027-06-01T03:59Z' }), '2026/2027');
  assert.equal(seasonName({ year: 2026, startDate: '2026-01-01T00:00Z', endDate: '2027-01-01T00:00Z' }), '2026');
});

test('share links are opened by the hosting and then recognised', async () => {
  const fetcher = async (url) => { assert.match(url, /calamar-match\.php\?url=https%3A%2F%2Fshare\.google%2FG9VWsVvXQpxwV65YS$/);
    return { ok: true, json: async () => ({ url: 'https://www.google.com/search?kgmid=/m/09gqx&hl=es-ES&q=LaLiga&shem=x' }) }; };
  const found = await competitionFromLink('https://share.google/G9VWsVvXQpxwV65YS', fetcher);
  assert.equal(found.query, 'LaLiga');
  assert.equal(found.competition.slug, 'esp.1');
});

test('rounds follow the calendar, postponed matches keep their round', () => {
  const start = Date.parse('2026-08-14T19:00:00Z');
  const at = (week, hours = 0) => new Date(start + week * 7 * DAY + hours * 3600000).toISOString();
  const matches = [
    // Round 1: A-B is postponed to midweek after round 3.
    { id: '1', date: at(0), home: 'C', away: 'D' }, { id: '2', date: at(3, 96), home: 'A', away: 'B' },
    { id: '3', date: at(1), home: 'A', away: 'C' }, { id: '4', date: at(1, 26), home: 'B', away: 'D' },
    { id: '5', date: at(2), home: 'D', away: 'A' }, { id: '6', date: at(2, 50), home: 'C', away: 'B' },
    { id: '7', date: at(3), home: 'B', away: 'A' }, { id: '8', date: at(3, 3), home: 'D', away: 'C' },
  ];
  const rounds = assignRounds(matches);
  assert.deepEqual(['1', '2', '3', '4', '5', '6', '7', '8'].map((id) => rounds.get(id)), [1, 1, 2, 2, 3, 3, 4, 4]);
});

test('the season keeps only its own matches, with the crests of the teams', () => {
  const old = espnEvent('100', '2026-05-20T19:00Z', rm, fcb, { year: 2025, done: true });
  const a = espnEvent('200', '2026-10-24T19:00Z', rm, fcb), b = espnEvent('201', '2027-01-10T19:00Z', atm, sev);
  const season = parseSeason([league, { events: [old, a] }, { events: [b, a] }], 'esp.1');
  assert.equal(season.name, 'LaLiga');
  assert.equal(season.season, '2026/2027');
  assert.deepEqual(season.matches.map((m) => m.id), ['200', '201']);
  assert.equal(season.teams.find((t) => t.espnId === '86').logo, 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png');
});

test('fetchSeason reads both calendar years of the season', async () => {
  const urls = [];
  const fetcher = async (url) => { urls.push(url); return { ok: true, json: async () => (url.endsWith('scoreboard') ? league : { events: url.includes('dates=2027') ? [espnEvent('201', '2027-01-10T19:00Z', atm, sev)] : [espnEvent('200', '2026-10-24T19:00Z', rm, fcb)] }) }; };
  const season = await fetchSeason('esp.1', fetcher);
  assert.deepEqual(urls.map((u) => u.replace(/^.*soccer\//, '')), ['esp.1/scoreboard', 'esp.1/scoreboard?dates=2026&limit=1000', 'esp.1/scoreboard?dates=2027&limit=1000']);
  assert.equal(season.matches.length, 2);
});

const now = Date.parse('2026-10-21T10:00:00Z'); // A Wednesday.
const base = () => ({ channels: [{ id: 'dazn', name: 'DAZN', streams: ['https://example.com/dazn.m3u8'] }], featured: [], hidden: [], events: [], leagues: [], teams: [{ id: 'mine', name: 'Real Madrid', logo: '' }] });
const seasonFixture = () => parseSeason([league, { events: [
  espnEvent('300', '2026-10-17T19:00Z', fcb, sev, { done: true }),
  espnEvent('301', '2026-10-24T14:00Z', rm, fcb), espnEvent('302', '2026-10-25T20:00Z', atm, sev),
  espnEvent('303', '2026-10-26T19:00Z', sev, rm), espnEvent('304', '2026-10-31T19:00Z', fcb, atm),
] }], 'esp.1');

test('importing creates the league, reuses teams by name and keeps only matches to play', () => {
  const { data, league: created, count } = applySeason(base(), seasonFixture(), now);
  assert.equal(count, 4);
  assert.equal(created.espn, 'esp.1');
  assert.equal(created.season, '2026/2027');
  assert.equal(data.teams.length, 4);
  const madrid = data.teams.find((t) => t.id === 'mine');
  assert.equal(madrid.espnId, '86');
  assert.match(madrid.logo, /86\.png$/);
  assert.deepEqual(data.fixtures.map((f) => f.matchId), ['301', '302', '303', '304']);
  const first = data.fixtures[0];
  assert.equal(first.homeTeamId, 'mine');
  assert.equal(first.round, 'Jornada 2');
  assert.equal(validateCatalog(data), data);
  const event = fixtureEvent(first, data);
  assert.equal(event.name, 'Real Madrid vs Barcelona');
  assert.equal(event.matchUrl, 'https://www.google.com/search?q=Real%20Madrid%20vs%20Barcelona');
  assert.equal(event.matchDate, first.startAt);
});

test('updating keeps the channel and cover set by hand and follows new times', () => {
  const imported = applySeason(base(), seasonFixture(), now).data;
  imported.fixtures[0] = { ...imported.fixtures[0], channelId: 'dazn', featured: true };
  const moved = seasonFixture();
  moved.matches.find((m) => m.id === '301').date = '2026-10-24T16:15:00.000Z';
  const { data } = applySeason(imported, moved, now);
  assert.equal(data.leagues.length, 1);
  assert.equal(data.teams.length, 4);
  assert.equal(data.fixtures.length, 4);
  assert.equal(data.fixtures[0].channelId, 'dazn');
  assert.equal(data.fixtures[0].featured, true);
  assert.equal(data.fixtures[0].startAt, '2026-10-24T16:15:00.000Z');
});

test('only the next five weeks are kept, unless a match already has a channel', () => {
  const far = seasonFixture();
  far.matches.push({ ...far.matches.find((m) => m.id === '304'), id: '399', date: '2026-12-20T19:00:00.000Z' });
  const first = applySeason(base(), far, now).data;
  assert.equal(first.fixtures.some((f) => f.matchId === '399'), false);
  // A later refresh brings it in once it is near.
  const later = applySeason(first, far, Date.parse('2026-11-20T10:00:00Z')).data;
  assert.equal(later.fixtures.some((f) => f.matchId === '399'), true);
  // Chosen by hand (a channel), it stays even if the window moves back.
  later.fixtures = later.fixtures.map((f) => (f.matchId === '399' ? { ...f, channelId: 'dazn' } : f));
  assert.equal(applySeason(later, far, now).data.fixtures.some((f) => f.matchId === '399'), true);
  // A catalog with the whole season shrinks to the window at the next refresh.
  const whole = { ...first, fixtures: [...first.fixtures, { ...first.fixtures[0], id: 'partido-399', matchId: '399', startAt: '2026-12-20T19:00:00.000Z' }] };
  assert.equal(applySeason(whole, far, now).data.fixtures.some((f) => f.matchId === '399'), false);
});

test('viewers see the Monday-to-Sunday week of the next match, then the next week', () => {
  assert.equal(madridWeek('2026-10-25T22:30:00Z'), '2026-10-19'); // Sunday 23:30 in Madrid is still that week.
  assert.equal(madridWeek('2026-10-25T23:30:00Z'), '2026-10-26'); // Monday 00:30 in Madrid.
  const { data } = applySeason(base(), seasonFixture(), now);
  data.fixtures[1].channelId = 'dazn';
  const channels = merge(null, data);
  const shown = (at) => events(channels, data, at).map((e) => e.matchId);
  assert.deepEqual(shown(now), ['301', '302']);
  // During the last match of Sunday it is still shown; once it is over, Monday's week appears.
  assert.deepEqual(shown(Date.parse('2026-10-25T21:00:00Z')), ['302']);
  assert.deepEqual(shown(Date.parse('2026-10-26T00:30:00Z')), ['303', '304']);
  const [pending, playable] = events(channels, data, now);
  assert.equal(pending.pending, true);
  assert.equal(pending.playable, false);
  assert.match(pending.meta, /Canal por confirmar$/);
  assert.match(pending.homeLogo, /86\.png$/);
  assert.equal(playable.playable, true);
  assert.equal(playable.channelName, 'DAZN');
  // Links to matches of other weeks still open.
  assert.equal(events(channels, data, now, { allWeeks: true }).length, 4);
});

test('imported matches never change the link of an event', () => {
  const { data } = applySeason(base(), seasonFixture(), now);
  data.events.push({ id: 'manual', name: 'Real Madrid vs Barcelona', cover: 'https://example.com/c.jpg', channelId: 'dazn', startAt: '2026-12-01T19:00:00Z' });
  const slugs = eventSlugs(data);
  assert.equal(slugs.get('manual'), 'real-madrid-vs-barcelona-1');
  assert.equal(slugs.get('partido-301'), 'real-madrid-vs-barcelona-2');
});

test('the catalog rejects broken imported matches', () => {
  const { data } = applySeason(base(), seasonFixture(), now);
  const broken = (change) => assert.throws(() => validateCatalog({ ...data, fixtures: [{ ...data.fixtures[0], ...change }] }));
  broken({ channelId: 'nope' });
  broken({ homeTeamId: 'nope' });
  broken({ startAt: 'mañana' });
  broken({ matchId: '' });
  broken({ cover: 'http://insecure.example/c.jpg' });
  broken({ awayTeamId: data.fixtures[0].homeTeamId });
  assert.throws(() => validateCatalog({ ...data, fixtures: [data.fixtures[0], data.fixtures[0]] }));
  assert.throws(() => validateCatalog({ ...data, leagues: [{ ...data.leagues[0], background: 'ftp://x' }] }));
});
