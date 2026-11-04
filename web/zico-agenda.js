import { zicoEventApi } from './event-sources.js';

const ORIGIN = 'https://bp.zicotv.cc';
const AGENDA = ORIGIN + '/api/v1/events';
const ownId = /^zico-event-\d+$/;
export const isZicoAgendaEvent = event => ownId.test(event?.id || '');

export async function fetchZicoAgenda(fetcher = globalThis.fetch) {
  const response = await fetcher(AGENDA, {
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw Error(`No se pudo consultar la agenda de ZicoTV (HTTP ${response.status}).`);
  return response.json();
}

const clean = value => typeof value === 'string' ? value.trim().slice(0, 180) : '';
const key = value => clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const matchKey = (name, startAt) => `${key(name)}|${Math.floor(Date.parse(startAt) / 60000)}`;
function httpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) return url;
  } catch { /* Ignore incomplete or invalid links. */ }
  return null;
}

function addEntity(list, name, badge, prefix) {
  const label = key(name);
  if (!label) return '';
  const existing = list.find(item => key(item.name) === label);
  if (existing) return existing.id;
  const base = prefix + label.replaceAll(' ', '-').slice(0, 85);
  let id = base;
  for (let n = 2; list.some(item => item.id === id); n++) id = `${base}-${n}`;
  list.push({ id, name, ...(badge ? { logo: badge.href } : {}) });
  return id;
}

function catalogSources(row) {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const own = [], direct = [], external = [];
  for (const source of sources) {
    if (!source) continue;
    const url = httpsUrl(source.player_url || source.url);
    if (!url || url.href.length > 2048 || url.searchParams.has('token')) continue;
    if (source.source === 'own' && ['bp.zicotv.cc', 'zicotv.cc'].includes(url.hostname)
      && /^\/api\/player\/\d+\/?$/.test(url.pathname)) own.push(ORIGIN + url.pathname.replace(/\/$/, ''));
    else if (source.is_premium || source.locked) continue;
    else if (source.type === 'direct') direct.push(url.href);
    else if (source.type === 'iframe' && !zicoEventApi(url.href)) external.push(url.href);
  }
  return [...new Set([...own, ...direct, ...external])].slice(0, 12);
}

const sportNames = { Soccer: 'Fútbol', Basketball: 'Baloncesto', Tennis: 'Tenis',
  'Ice Hockey': 'Hockey sobre hielo', Handball: 'Balonmano', Volleyball: 'Voleibol',
  Motorsport: 'Motor', Futsal: 'Fútbol sala', Cycling: 'Ciclismo', Fighting: 'Combate', Other: 'Otros deportes' };

export function applyZicoAgenda(catalog, payload, fixtures = []) {
  if (!Array.isArray(payload?.data) || payload.data.length !== payload.total
    || payload.data.some(row => !Number.isSafeInteger(row?.id) || row.id < 1 || typeof row.status !== 'string')) {
    throw Error('ZicoTV devolvió una agenda con un formato inesperado.');
  }
  const current = catalog.events || [];
  const previous = new Map(current.filter(isZicoAgendaEvent).map(event => [event.id, event]));
  const events = current.filter(event => !isZicoAgendaEvent(event));
  const leagues = [...(catalog.leagues || [])], teams = [...(catalog.teams || [])];
  const manual = [...events, ...fixtures];
  const manualLinks = new Set(manual.flatMap(event => event.streams || []).map(link => zicoEventApi(link)?.split('/').at(-1)).filter(Boolean));
  const occupied = new Set(manual.map(event => matchKey(event.name, event.startAt)));
  let count = 0, skipped = 0;
  const channels = new Map((catalog.channels || []).map(channel => [channel.id, channel]));
  const seen = new Set();
  for (const row of payload.data) {
    if (!['live', 'scheduled'].includes(row.status)) continue;
    const name = clean(row.title), start = Date.parse(row.start_time);
    if (!name || !Number.isFinite(start)) continue;
    const id = `zico-event-${row.id}`, startAt = new Date(start).toISOString();
    const match = matchKey(name, startAt);
    if (seen.has(id) || manualLinks.has(String(row.id)) || occupied.has(match)) continue;
    seen.add(id);

    const old = previous.get(id);
    const sources = catalogSources(row);
    const zicoStreams = [`${ORIGIN}/events/${row.id}`, ...sources];
    const manualStreams = (old?.streams || []).filter(url => !old.zicoStreams?.includes(url));
    const channel = channels.get(old?.channelId);
    if (![...sources, ...manualStreams, ...(channel?.streams || [])].some(url => !zicoEventApi(url))) {
      skipped++;
      continue;
    }
    occupied.add(match);
    const streams = [...new Set([zicoStreams[0], ...manualStreams, ...sources])].slice(0, 50);
    const competition = clean(row.league) || sportNames[row.sport_category] || clean(row.sport_category);
    const leagueId = old?.leagueId || addEntity(leagues, competition, null, 'zico-liga-');
    const homeTeamId = old?.homeTeamId || addEntity(teams, clean(row.home_team), httpsUrl(row.home_team_badge), 'zico-equipo-');
    const awayTeamId = old?.awayTeamId || addEntity(teams, clean(row.away_team), httpsUrl(row.away_team_badge), 'zico-equipo-');
    events.push({
      ...old, id, name: old?.name || name, startAt, leagueId, homeTeamId,
      awayTeamId: awayTeamId === homeTeamId ? '' : awayTeamId,
      venue: old?.venue || clean(row.venue), status: row.status, imported: true,
      cover: old?.cover || '', streams, zicoStreams,
    });
    count++;
  }
  return { data: { ...catalog, events, leagues, teams }, count, skipped };
}
