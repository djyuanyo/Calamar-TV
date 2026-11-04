import { zicoEventApi } from './event-sources.js';
import { COMPETITIONS, fixtureEvent } from './competitions.js';

const ORIGIN = 'https://bp.zicotv.cc';
const AGENDA = ORIGIN + '/api/v1/events';
const ownId = /^zico-event-\d+$/;
export const isZicoAgendaEvent = event => ownId.test(event?.id || '');
export const usesZicoAgenda = event => isZicoAgendaEvent(event) || !!event?.zicoEventId;

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

const MATCH_TOLERANCE = 15 * 60000;
const competitionNames = new Map(COMPETITIONS.flatMap(c => [c.name, ...c.aliases].map(name => [key(name), c.slug])));
const competitionCodes = new Set(COMPETITIONS.map(c => c.slug));
const leagueKey = name => {
  const label = key(name), tail = key(clean(name).split(':').at(-1));
  return competitionNames.get(label) || competitionNames.get(tail) || label;
};
const teamKey = name => key(name)
  .replace(/\b(?:f c|a f c|fc|cf|afc|cd|ud|sk|fk|sc|sv|aif|and)\b/g, ' ')
  .replace(/\brb\b/g, 'red bull').replace(/\bst\b/g, 'saint')
  .replace(/\bkobenhavn\b/g, 'copenhagen').replace(/\s+/g, ' ').trim();
const teamLevel = name => name.match(/\b(?:youth|primavera|reserves?|juniors?|women|femenin[oa]|u ?[0-9]{2}|b|ii)\b/g)?.join(' ') || '';

function teamScore(a, b, sameLeague) {
  if (!a || !b) return 0;
  if (a === b) return 2;
  if (!sameLeague || teamLevel(a) !== teamLevel(b)) return 0;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return short.length >= 4 && ` ${long} `.includes(` ${short} `) ? 1 : 0;
}

function matchCandidate(candidate, match) {
  const distance = Math.abs(candidate.start - match.start);
  if (!Number.isFinite(distance) || distance > MATCH_TOLERANCE) return null;
  const sameLeague = !!match.league && match.league === candidate.league;
  if (!sameLeague && competitionCodes.has(candidate.league) && competitionCodes.has(match.league)) return null;
  const home = teamScore(candidate.home, match.home, sameLeague);
  const away = teamScore(candidate.away, match.away, sameLeague);
  const score = home && away ? home + away : (candidate.name === match.name ? 4 : 0);
  return score ? { candidate, score, distance } : null;
}

function withoutZicoSignals(item) {
  if (!item.zicoEventId) return item;
  const { zicoEventId, zicoStreams, ...rest } = item;
  return { ...rest, streams: (item.streams || []).filter(url => !zicoStreams?.includes(url)) };
}

export function applyZicoAgenda(catalog, payload) {
  if (!Array.isArray(payload?.data) || payload.data.length !== payload.total
    || payload.data.some(row => !Number.isSafeInteger(row?.id) || row.id < 1 || typeof row.status !== 'string')) {
    throw Error('ZicoTV devolvió una agenda con un formato inesperado.');
  }
  const current = catalog.events || [];
  const previous = new Map(current.filter(isZicoAgendaEvent).map(event => [event.id, event]));
  const existing = current.filter(event => !isZicoAgendaEvent(event));
  const fixtures = catalog.fixtures || [];
  const leagues = [...(catalog.leagues || [])], teams = [...(catalog.teams || [])];
  const leaguesById = new Map(leagues.map(league => [league.id, league.espn || leagueKey(league.name)]));
  const teamsById = new Map(teams.map(team => [team.id, teamKey(team.name)]));
  const manual = [...existing, ...fixtures.map(fixture => fixtureEvent(fixture, catalog))].map(event => ({
    id: event.id, name: key(event.name), start: Date.parse(event.startAt),
    league: leaguesById.get(event.leagueId), home: teamsById.get(event.homeTeamId), away: teamsById.get(event.awayTeamId),
    explicit: new Set([event.zicoEventId, ...(event.streams || []).map(link => zicoEventApi(link)?.split('/').at(-1))]),
  }));
  const occupied = new Set(), assigned = new Map(), events = [];
  let count = 0, skipped = 0, linked = 0;
  const channels = new Map((catalog.channels || []).map(channel => [channel.id, channel]));
  const seen = new Set();
  for (const row of payload.data) {
    if (!['live', 'scheduled'].includes(row.status)) continue;
    const name = clean(row.title), start = Date.parse(row.start_time);
    if (!name || !Number.isFinite(start)) continue;
    const id = `zico-event-${row.id}`, startAt = new Date(start).toISOString();
    const match = matchKey(name, startAt);
    if (seen.has(id) || occupied.has(match)) continue;
    seen.add(id);

    const zicoId = String(row.id), league = leagueKey(row.league);
    const explicit = manual.filter(candidate => candidate.explicit.has(zicoId));
    const details = { start, league, name: key(name), home: teamKey(row.home_team), away: teamKey(row.away_team) };
    const ranked = explicit.length ? [] : manual.map(candidate => matchCandidate(candidate, details))
      .filter(Boolean).sort((a, b) => b.score - a.score || a.distance - b.distance);
    const [best, second] = ranked;
    const tied = second && best.score === second.score && best.distance === second.distance;
    const target = explicit.length === 1 ? explicit[0] : !explicit.length && !tied ? best?.candidate : null;
    const old = previous.get(id);
    const sources = catalogSources(row);
    const zicoStreams = [`${ORIGIN}/events/${row.id}`, ...sources];
    if (target || explicit.length || ranked.length) {
      if (target && sources.length && !assigned.has(target.id)) {
        assigned.set(target.id, { zicoEventId: zicoId, zicoStreams });
        linked++;
      }
      if (!sources.length) skipped++;
      continue;
    }
    const manualStreams = (old?.streams || []).filter(url => !old.zicoStreams?.includes(url));
    const channel = channels.get(old?.channelId);
    if (![...sources, ...manualStreams, ...(channel?.streams || [])].some(url => !zicoEventApi(url))) {
      skipped++;
      continue;
    }
    occupied.add(match);
    const streams = [...new Set([zicoStreams[0], ...manualStreams, ...sources])].slice(0, 50);
    const competition = clean(row.league) || sportNames[row.sport_category] || clean(row.sport_category);
    const existingLeague = row.sport_category === 'Soccer' && league
      ? leagues.find(item => !item.id.startsWith('zico-liga-') && leaguesById.get(item.id) === league) : null;
    const leagueId = existingLeague?.id || old?.leagueId || addEntity(leagues, competition, null, 'zico-liga-');
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
  const applySignals = item => {
    const base = withoutZicoSignals(item), linkedSignals = assigned.get(item.id);
    if (!linkedSignals) return base;
    const manualStreams = base.streams || [];
    const zicoStreams = linkedSignals.zicoStreams.filter(url => !manualStreams.includes(url)).slice(0, Math.max(0, 50 - manualStreams.length));
    return { ...base, streams: [...manualStreams, ...zicoStreams], zicoEventId: linkedSignals.zicoEventId, zicoStreams };
  };
  const data = { ...catalog, events: [...existing.map(applySignals), ...events], leagues, teams };
  if (catalog.fixtures) data.fixtures = fixtures.map(applySignals);
  return { data, count, skipped, linked };
}
