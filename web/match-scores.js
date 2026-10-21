/** Google identifies the fixture; ESPN supplies the actual clock and result (no estimated minutes). */
export const MATCH_RESOLVER = 'https://calamarmenciano.com/calamar-match.php';
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/all/';
export function googleMatchUrl(value) {
  const u = new URL(String(value).trim());
  if (u.protocol !== 'https:' || u.username || u.password || u.port || value.length > 8192) throw Error('Usa un enlace HTTPS de Google o share.google.');
  if (u.hostname === 'share.google' && /^\/[A-Za-z0-9_-]+$/.test(u.pathname)) return u.href;
  if (!['google.com', 'www.google.com', 'google.es', 'www.google.es'].includes(u.hostname) || u.pathname !== '/search' || !u.searchParams.get('q')?.trim()) throw Error('Pega el enlace del partido de Google o share.google.');
  return u.href;
}
const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function mentioned(team, query) {
  return ['displayName', 'shortDisplayName', 'name'].some(key => {
    const alias = normal(team?.[key]);
    return alias.length >= 4 && (` ${query} `).includes(` ${alias} `);
  });
}
export function identifyMatch(data, query, startAt) {
  const date = Date.parse(startAt);
  if (!Number.isFinite(date)) throw Error('Indica primero la fecha y hora del evento.');
  const matches = (data.events || []).filter(e => {
    const c = e.competitions?.[0];
    return Math.abs(Date.parse(e.date) - date) <= 18 * 3600000 && c?.competitors?.length === 2 && c.competitors.every(t => mentioned(t.team, normal(query)));
  });
  if (matches.length !== 1) throw Error(matches.length ? 'Hay varios partidos: comprueba el enlace y la fecha.' : 'No se encontró este partido en los resultados. Comprueba el enlace, la fecha y los equipos.');
  return matches[0];
}
export function matchResult(data) {
  const e = data.header || data, c = e.competitions?.[0];
  const s = c?.status || e.status, t = s?.type;
  if (!c || !t) throw Error('Respuesta de marcador incompleta.');
  const home = c.competitors?.find(x => x.homeAway === 'home'), away = c.competitors?.find(x => x.homeAway === 'away');
  if (!home || !away) throw Error('Faltan los equipos del marcador.');
  const state = t.name?.includes('POSTPON') ? 'postponed' : t.name?.includes('CANCEL') ? 'cancelled' : t.name?.includes('SUSPEND') || t.name?.includes('DELAY') || t.name?.includes('ABANDON') ? 'suspended' : t.completed ? 'finished' : t.name === 'STATUS_HALFTIME' ? 'halftime' : t.state === 'in' ? 'live' : 'scheduled';
  const score = x => typeof x.score === 'object' ? x.score?.displayValue : x.score;
  const scored = ['live', 'halftime', 'finished', 'suspended'].includes(state) && /^\d+$/.test(String(score(home))) && /^\d+$/.test(String(score(away)));
  const clock = state === 'live' && /\d/.test(s.displayClock || '') ? s.displayClock.replace(/'/g, '′') : '';
  const status = { finished: 'Finalizado', halftime: 'Descanso', postponed: 'Aplazado', cancelled: 'Cancelado', suspended: 'Interrumpido', scheduled: 'Programado', live: clock ? `En juego · ${clock}` : 'En juego' }[state];
  const ended = state === 'finished' && data.meta?.gameState === 'post' ? Date.parse(data.meta.lastPlayWallClock || '') : NaN;
  const start = Date.parse(c.date || e.date || '');
  const finishedAt = Number.isFinite(ended) && Number.isFinite(start) && ended >= start ? ended : 0;
  return { finishedAt, id: String(e.id || c.id), home: home.team.displayName, away: away.team.displayName, state, clock,
    text: `${scored ? `${score(home)} – ${score(away)} · ` : ''}${status}`, live: state === 'live' || state === 'halftime' };
}
async function json(url, fetcher) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
  if (!r.ok) throw Error(`No se pudo consultar el partido (HTTP ${r.status}).`);
  return r.json();
}
export async function resolveMatch(value, startAt, fetcher = globalThis.fetch) {
  const matchUrl = googleMatchUrl(value);
  let googleUrl = matchUrl;
  if (new URL(matchUrl).hostname === 'share.google') {
    let data;
    try { data = await json(`${MATCH_RESOLVER}?url=${encodeURIComponent(matchUrl)}`, fetcher); }
    catch { throw Error('No se pudo abrir el enlace corto. Comprueba que calamar-match.php esté subido al hosting, o pega el enlace completo de Google.'); }
    googleUrl = googleMatchUrl(data.url);
    if (new URL(googleUrl).hostname === 'share.google') throw Error('Google no ha devuelto el partido. Abre el enlace y copia la dirección completa.');
  }
  const date = Date.parse(startAt);
  if (!Number.isFinite(date)) throw Error('Indica primero la fecha y hora del evento.');
  const day = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
  const board = await json(`${API}scoreboard?dates=${day(date)}&limit=1000`, fetcher);
  const event = identifyMatch(board, new URL(googleUrl).searchParams.get('q'), startAt);
  return { matchUrl, matchId: String(event.id), matchDate: new Date(event.date).toISOString(), result: matchResult(event) };
}
export const EVENT_GRACE_MS = 5 * 60000;
const storageKey = 'calamar-match-finished-v1';
const finished = new Map();
try {
  for (const [id, at] of Object.entries(JSON.parse(globalThis.localStorage?.getItem(storageKey) || '{}'))) {
    if (/^\d{1,20}$/.test(id) && Number.isSafeInteger(at) && at > 0) finished.set(id, at);
  }
} catch { /* Storage may be unavailable; the provider's end timestamp still works. */ }
export function rememberMatch(id, result, now = Date.now()) {
  if (result.state === 'finished') {
    const at = result.finishedAt > 0 && result.finishedAt <= now + 60000 ? result.finishedAt : finished.get(id) || now;
    finished.set(id, at);
  } else finished.delete(id); // A corrected final status must make the event visible again.
  try { globalThis.localStorage?.setItem(storageKey, JSON.stringify(Object.fromEntries(finished))); } catch {}
  return result;
}
export const matchDeadline = id => finished.has(String(id)) ? finished.get(String(id)) + EVENT_GRACE_MS : 0;
export const matchExpired = (id, now = Date.now()) => matchDeadline(id) > 0 && now >= matchDeadline(id);
// Retained admin history must not download years of old matches every 30 seconds.
export const shouldPollMatch = (id, now = Date.now()) => !matchExpired(id, now) || now - matchDeadline(id) < 86400000;
const cache = new Map();
export async function fetchMatch(id, fetcher = globalThis.fetch) {
  if (!/^\d{1,20}$/.test(String(id))) throw Error('Identificador de partido no válido.');
  const old = cache.get(id);
  if (old && Date.now() - old.at < (matchExpired(id) ? 600000 : 30000)) return old.promise;
  const promise = json(`${API}summary?event=${id}`, fetcher).then(matchResult).then(result => rememberMatch(String(id), result));
  cache.set(id, { at: Date.now(), promise });
  try { return await promise; } catch (e) { cache.delete(id); throw e; }
}
