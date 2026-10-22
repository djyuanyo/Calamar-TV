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
// Google writes many names in Spanish; ESPN uses the international ones. Both forms are kept.
const SPANISH = [['club brujas', 'club brugge'], ['brujas', 'brugge'], ['napoles', 'napoli'], ['oporto', 'porto'], ['lisboa', 'lisbon'],
  ['sporting de portugal', 'sporting cp'], ['estrella roja', 'crvena zvezda red star'], ['turin', 'torino'], ['inter de milan', 'inter milan internazionale'],
  ['bayern de munich', 'bayern munich'], ['marsella', 'marseille'], ['olympique de lyon', 'lyon'], ['copenhague', 'copenhagen'], ['salzburgo', 'salzburg'],
  ['praga', 'prague'], ['amberes', 'antwerp'], ['estambul', 'istanbul'], ['psg', 'paris saint germain'], ['man city', 'manchester city'],
  ['man united', 'manchester united'], ['spurs', 'tottenham'], ['inglaterra', 'england'], ['alemania', 'germany'], ['francia', 'france'],
  ['italia', 'italy'], ['paises bajos', 'netherlands'], ['holanda', 'netherlands'], ['belgica', 'belgium'], ['suiza', 'switzerland'], ['suecia', 'sweden'],
  ['noruega', 'norway'], ['dinamarca', 'denmark'], ['croacia', 'croatia'], ['polonia', 'poland'], ['turquia', 'turkey turkiye'], ['grecia', 'greece'],
  ['gales', 'wales'], ['escocia', 'scotland'], ['irlanda', 'ireland'], ['rumania', 'romania'], ['hungria', 'hungary'], ['republica checa', 'czechia czech republic'],
  ['eslovaquia', 'slovakia'], ['eslovenia', 'slovenia'], ['ucrania', 'ukraine'], ['islandia', 'iceland'], ['finlandia', 'finland'], ['marruecos', 'morocco'],
  ['estados unidos', 'united states usa'], ['brasil', 'brazil'], ['japon', 'japan'], ['corea del sur', 'south korea'], ['arabia saudi', 'saudi arabia'],
  ['egipto', 'egypt'], ['camerun', 'cameroon'], ['sudafrica', 'south africa'], ['nueva zelanda', 'new zealand'], ['argelia', 'algeria'], ['tunez', 'tunisia']];
// Words shared by many clubs: on their own they do not identify a team.
const GENERIC = new Set(['fc', 'cf', 'sc', 'ac', 'cd', 'ud', 'sd', 'rc', 'afc', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'real', 'city', 'united',
  'sporting', 'athletic', 'atletico', 'deportivo', 'racing', 'union', 'olympique', 'borussia', 'inter', 'fk', 'sk', 'ss', 'as', 'us', 'ssc', 'sv', 'vfb',
  'vfl', 'tsg', 'rb', 'cp', 'sa', 'the', 'and', 'saint', 'st', 'san', 'santa', 'town', 'rovers', 'wanderers', 'county', 'albion', 'vs', 'contra', 'v']);
export function expandQuery(query) {
  let text = ` ${normal(query)} `;
  for (const [es, en] of SPANISH) if (text.includes(` ${es} `)) text += `${en} `;
  return text.trim();
}
/** How well a team appears in the link's text: 1 its full name, a fraction for its distinctive words, 0 not at all. */
export function teamScore(team, query) {
  const text = ` ${query} `, words = new Set(query.split(' '));
  const aliases = ['displayName', 'shortDisplayName', 'name', 'location', 'nickname'].map(key => normal(team?.[key])).filter(Boolean);
  if (aliases.some(alias => alias.length >= 4 && text.includes(` ${alias} `))) return 1;
  const abbreviation = normal(team?.abbreviation);
  if (abbreviation.length >= 3 && words.has(abbreviation)) return 1;
  const distinctive = [...new Set(aliases.flatMap(alias => alias.split(' ')))].filter(w => w.length >= 3 && !GENERIC.has(w));
  const found = distinctive.filter(w => words.has(w)).length;
  return distinctive.length ? found / distinctive.length : 0;
}
/**
 * The match of the link: both teams named beats one, a fuller name beats a partial one, and among equals
 * the closest to the event's date wins. The event's own teams and name are not used, so a link works
 * even when the event was named differently.
 */
export function identifyMatch(data, query, startAt) {
  const center = Number.isFinite(Date.parse(startAt)) ? Date.parse(startAt) : Date.now();
  const text = expandQuery(query);
  const ranked = (data.events || []).map(e => {
    const teams = e.competitions?.[0]?.competitors || [];
    if (teams.length !== 2) return null;
    const scores = teams.map(t => teamScore(t.team, text));
    return { e, both: scores.every(x => x > 0), total: scores[0] + scores[1], distance: Math.abs(Date.parse(e.date) - center) };
  }).filter(x => x && x.total > 0)
    .sort((a, b) => (b.both - a.both) || (b.total - a.total) || (a.distance - b.distance));
  if (!ranked.length) throw Error('No se encontró este partido en los resultados de ESPN. Comprueba que el enlace sea de un partido de fútbol.');
  return Object.assign(ranked[0].e, { bothTeams: ranked[0].both });
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
  const date = Number.isFinite(Date.parse(startAt)) ? Date.parse(startAt) : Date.now();
  const day = ms => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
  const query = new URL(googleUrl).searchParams.get('q');
  // First the event's day; when that does not show both teams, the three days around it too, in case
  // the event's date and the match's do not agree.
  let event = null;
  try { event = identifyMatch(await json(`${API}scoreboard?dates=${day(date)}&limit=1000`, fetcher), query, startAt); } catch {}
  if (!event?.bothTeams) {
    try { event = identifyMatch(await json(`${API}scoreboard?dates=${day(date - 3 * 86400000)}-${day(date + 3 * 86400000)}&limit=1000`, fetcher), query, startAt); }
    catch (error) { if (!event) throw error; }
  }
  return { matchUrl, matchId: String(event.id), matchDate: new Date(event.date).toISOString(), result: matchResult(event), bothTeams: event.bothTeams };
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
/** ESPN's whole match summary (score, events, statistics, line-ups), shared by the badge and the match page. */
export async function fetchSummary(id, fetcher = globalThis.fetch) {
  if (!/^\d{1,20}$/.test(String(id))) throw Error('Identificador de partido no válido.');
  const old = cache.get(id);
  if (old && Date.now() - old.at < (matchExpired(id) ? 600000 : 30000)) return old.promise;
  const promise = json(`${API}summary?event=${id}`, fetcher);
  cache.set(id, { at: Date.now(), promise });
  try { return await promise; } catch (e) { cache.delete(id); throw e; }
}
export async function fetchMatch(id, fetcher = globalThis.fetch) {
  return rememberMatch(String(id), matchResult(await fetchSummary(id, fetcher)));
}
