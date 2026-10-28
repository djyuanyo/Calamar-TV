import { googleMatchUrl } from './match-scores.js';
export const EVENT_STATES = { scheduled: 'Programado', live: 'En juego', finished: 'Finalizado' };
/** The event's link uses the slug of its name, like channels: #/evento/local-vs-visitante. */
export const eventPath = (event) => `#/evento/${encodeURIComponent(event.slug || event.eventId || event.id)}`;
export const WEB_BASE = 'https://djyuanyo.github.io/Calamar-TV/';
/**
 * Link to share: tools/event_pages.py publishes evento/<slug>/ on the public web with the cover and
 * the name for WhatsApp, and it opens the event. Until that page exists 404.html still opens it.
 */
export const eventShareLink = (event) => `${WEB_BASE}evento/${encodeURIComponent(event.slug || event.eventId || event.id)}/`;
/** A league's link to share: tools/event_pages.py publishes liga/<slug>/ with the league's card. */
export const leagueShareLink = (slug) => `${WEB_BASE}liga/${encodeURIComponent(slug)}/`;
/** A channel's link to share: tools/event_pages.py publishes canal/<slug>/ with its logo card. */
export const channelShareLink = (channel) => `${WEB_BASE}canal/${encodeURIComponent(channel.slug || channel.id)}/`;
export const eventOrder = (a, b) => (Date.parse(a.startAt) || Infinity) - (Date.parse(b.startAt) || Infinity) || String(a.id).localeCompare(String(b.id));
export function eventMeta(event, data) {
  const league = (data?.leagues || []).find((l) => l.id === event.leagueId)?.name || '';
  const date = event.startAt ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(event.startAt)) : '';
  return [league, date, event.round, event.venue].filter(Boolean).join(' · ');
}
export function localDateTime(iso) {
  if (!iso) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Madrid wall time, including daylight saving; rejects impossible dates and DST gaps. */
export function madridInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Indica fecha y hora válidas.');
  const wanted = Date.parse(value + ':00Z');
  let result = wanted;
  for (let i = 0; i < 3; i++) {
    const wall = localDateTime(new Date(result).toISOString());
    result += wanted - Date.parse(wall + ':00Z');
  }
  const iso = new Date(result).toISOString();
  if (localDateTime(iso) !== value) throw new Error('Esta fecha u hora no existe en Madrid. Elige otra hora.');
  return iso;
}
export function validateSports(data, imageValid) {
  const sets = {};
  for (const kind of ['leagues', 'teams']) {
    if (data[kind] !== undefined && !Array.isArray(data[kind])) throw new Error('La lista de ligas o equipos no es válida.');
    sets[kind] = new Set();
    for (const item of data[kind] || []) {
      if (!item || typeof item.id !== 'string' || !item.id || sets[kind].has(item.id) || typeof item.name !== 'string' || !item.name.trim() || (item.logo && !imageValid(item.logo)) || (item.background && !imageValid(item.background))) throw new Error('Hay una liga o equipo incompleto o duplicado.');
      sets[kind].add(item.id);
    }
  }
  for (const team of data.teams || []) if (team.leagueId && !sets.leagues.has(team.leagueId)) throw new Error('La liga del equipo no existe.');
  for (const event of data.events || []) {
    if (event.startAt !== undefined && event.startAt !== '' && (typeof event.startAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(event.startAt) || (!Number.isFinite(Date.parse(event.startAt)) || new Date(event.startAt).toISOString().replace('.000Z', 'Z') !== event.startAt.replace('.000Z', 'Z')))) throw new Error('La fecha del evento no es válida.');
    if (event.matchUrl) { googleMatchUrl(event.matchUrl); if (!/^\d{1,20}$/.test(event.matchId || '') || !Number.isFinite(Date.parse(event.matchDate))) throw Error('Comprueba el partido antes de guardar el evento.'); }
    if (event.featured !== undefined && typeof event.featured !== 'boolean') throw new Error('Destacado no válido.');
    if (event.status && !EVENT_STATES[event.status]) throw new Error('El estado del evento no es válido.');
    if ((event.leagueId && !sets.leagues.has(event.leagueId)) || [event.homeTeamId, event.awayTeamId].some(id => id && !sets.teams.has(id))) throw new Error('La liga o los equipos del evento no existen.');
    if (event.homeTeamId && event.homeTeamId === event.awayTeamId) throw new Error('Local y visitante deben ser diferentes.');
    for (const key of ['season', 'round', 'venue', 'description']) if (event[key] !== undefined && (typeof event[key] !== 'string' || event[key].length > 4000)) throw new Error('Los detalles del evento no son válidos.');
  }
}
