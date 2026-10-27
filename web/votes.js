// The visitors' own 1X2 poll of a match: one vote per browser or app install and match, which can be
// changed until kick-off. Votes are kept on the hosting (hosting/calamar-votes.php) with no personal
// data, only the match and the pick.
import { teamWords } from './polymarket.js';

export const VOTES_ENDPOINT = 'https://calamarmenciano.com/calamar-votes.php';
export const VOTES_MS = 120000;
export const PICKS = ['1', 'X', '2'];
const VOTER_KEY = 'calamar-voter', PICKS_KEY = 'calamar-votes';

/** The same match on the web and the app: «2026-10-30-villarreal-espanyol» (UTC day of kick-off, teams). */
export function matchKey(home, away, date) {
  const day = String(date || '').slice(0, 10);
  const team = (name) => teamWords(name).join('-').slice(0, 60);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !team(home) || !team(away)) return '';
  return `${day}-${team(home)}-${team(away)}`;
}

/** Voting closes at kick-off: before it the match is still «scheduled». */
export function votingOpen(m, now = Date.now()) {
  const at = Date.parse(m?.date || '');
  return m?.state === 'scheduled' && (!Number.isFinite(at) || now < at);
}

/** The votes of a match: { h, d, a }. */
export async function fetchVotes(match, fetcher = globalThis.fetch) {
  const response = await fetcher(`${VOTES_ENDPOINT}?match=${encodeURIComponent(match)}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('No se pudieron leer los votos.');
  return response.json();
}

/** Counts or changes this visitor's vote and returns the new totals. Plain text, so there is no preflight. */
export async function sendVote(voter, match, pick, fetcher = globalThis.fetch) {
  if (!match || !PICKS.includes(pick)) throw new Error('Voto no válido.');
  const response = await fetcher(VOTES_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ match, voter, pick }),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'No se ha podido guardar el voto. Inténtalo de nuevo.');
  return data;
}

/** Totals as percentages adding up to 100 (largest remainder), or null without votes. */
export function tally({ h = 0, d = 0, a = 0 } = {}) {
  const counts = [h, d, a].map((n) => Math.max(0, Math.round(Number(n) || 0)));
  const total = counts[0] + counts[1] + counts[2];
  if (!total) return { home: 0, draw: 0, away: 0, total: 0 };
  const exact = counts.map((n) => (n / total) * 100), pct = exact.map(Math.floor);
  const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0]);
  for (let i = 0; i < 100 - pct.reduce((s, n) => s + n, 0); i++) pct[order[i][1]]++;
  return { home: pct[0], draw: pct[1], away: pct[2], total };
}

/** A random id kept in this browser: it only tells this visitor's vote apart, it identifies nobody. */
export function voterId(storage = globalThis.localStorage, random = () => crypto.getRandomValues(new Uint8Array(24))) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  try {
    const known = storage.getItem(VOTER_KEY);
    if (/^[A-Za-z0-9]{24}$/.test(known || '')) return known;
  } catch {}
  const id = Array.from(random(), (n) => letters[n % letters.length]).join('');
  try { storage.setItem(VOTER_KEY, id); } catch {}
  return id;
}

/** This visitor's picks by match, kept in the browser (at most the last 200 matches). */
export function myPick(match, storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(PICKS_KEY) || '{}')[match] || ''; } catch { return ''; }
}
export function rememberPick(match, pick, storage = globalThis.localStorage) {
  try {
    const all = JSON.parse(storage.getItem(PICKS_KEY) || '{}');
    delete all[match];
    all[match] = pick;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete all[k];
    storage.setItem(PICKS_KEY, JSON.stringify(all));
  } catch {}
}
