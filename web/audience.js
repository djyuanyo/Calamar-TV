// Live viewers and visit counters. Pure helpers shared by the player, the admin panel and the tests;
// Firestore access lives in firebase.js and the limits are enforced by firebase/firestore.rules.
export const AUDIENCE_PATH = 'calamarAudience';
export const VISITS_PATH = 'calamarVisits';
/** Each viewer refreshes its presence once a minute; anyone seen in the last ~3 minutes counts. */
export const HEARTBEAT_MS = 60000;
export const COUNT_MS = 30000;

export const minuteOf = (now = Date.now()) => Math.floor(now / 60000);

/** 'c:la-1' for a channel, 'e:evento-…' for an event. */
export function audienceTarget(item) {
  return item.event ? `e:${item.eventId || item.id}` : `c:${item.id}`;
}

/** The beats a reader accepts: two minutes back and one ahead, to absorb clock differences. */
export function liveBeats(target, now = Date.now()) {
  const m = minuteOf(now);
  return [m - 2, m - 1, m, m + 1].map((minute) => `${target}|${minute}`);
}

export function presence(target, now = Date.now()) {
  const minute = minuteOf(now);
  return { target, minute, beat: `${target}|${minute}` };
}

export function sessionId() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (n) => letters[n % letters.length]).join('');
}

/** Field name of a channel or event inside a daily visits document. */
export function visitKey(kind, id) {
  return `${kind === 'event' ? 'e' : 'c'}_${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 140)}`;
}

/** Calendar day in Madrid, the same day for every visitor: 2026-10-21. */
export function madridDay(now = Date.now()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

/** Live presence documents grouped by what they watch: Map(target -> viewers). */
export function liveCounts(docs, now = Date.now()) {
  const from = minuteOf(now) - 2, to = minuteOf(now) + 1;
  const out = new Map();
  for (const d of docs) if (Number.isInteger(d.minute) && d.minute >= from && d.minute <= to && typeof d.target === 'string') out.set(d.target, (out.get(d.target) || 0) + 1);
  return out;
}

/**
 * Adds up daily documents ({ id: '2026-10-21', data: { c_la-1: 3 } }) for a period.
 * by: 'day' groups by date, 'month' by YYYY-MM, 'year' by YYYY. Returns totals per key and per bucket.
 */
export function summarize(days, by = 'day', only = null) {
  const totals = new Map(), buckets = new Map();
  const size = by === 'year' ? 4 : by === 'month' ? 7 : 10;
  for (const { id, data } of days) {
    const bucket = id.slice(0, size);
    for (const [key, value] of Object.entries(data || {})) {
      if (!Number.isFinite(value) || value <= 0 || (only && key !== only)) continue;
      totals.set(key, (totals.get(key) || 0) + value);
      buckets.set(bucket, (buckets.get(bucket) || 0) + value);
    }
  }
  return { totals, buckets };
}

/** Badge of an event card: its date and time until it starts, then live or finished. */
export function eventLabel(event, now = Date.now(), states = {}) {
  if (event.status === 'finished') return { text: states.finished || 'Finalizado', live: false };
  const start = Date.parse(event.startAt || '');
  if (Number.isFinite(start) && now < start) return { text: eventStart(start), live: false, upcoming: true };
  if (Number.isFinite(start) || event.status === 'live') return { text: 'En directo', live: true };
  return { text: states[event.status || 'scheduled'] || 'Programado', live: false };
}

export function eventStart(time) {
  const part = (options) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', ...options }).format(new Date(time));
  return `${part({ weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '')} · ${part({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

/** Milliseconds until the next event starts, so the home page can switch its badge on time. */
export function nextStart(list, now = Date.now()) {
  const times = list.map((e) => Date.parse(e.startAt || '')).filter((t) => Number.isFinite(t) && t > now);
  return times.length ? Math.min(...times) - now : null;
}
