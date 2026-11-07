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

function addEntity(list, name, badge, prefix, generatedOnly = false) {
  const label = key(name);
  if (!label) return '';
  const existing = list.find(item => key(item.name) === label && (!generatedOnly || item.id.startsWith(prefix)));
  if (existing) return existing.id;
  const base = prefix + label.replaceAll(' ', '-').slice(0, 85);
  let id = base;
  for (let n = 2; list.some(item => item.id === id); n++) id = `${base}-${n}`;
  list.push({ id, name, ...(badge ? { logo: badge.href } : {}) });
  return id;
}

// The feed is used to check availability. Playback resolves the current sources from the event URL.
function hasZicoSource(row) {
  const sources = Array.isArray(row.sources) ? row.sources : [];
  const playable = (source, provider) => {
    const url = httpsUrl(source?.player_url || source?.url);
    if (!url || url.href.length > 2048 || url.searchParams.has('token') || zicoEventApi(url.href)) return false;
    if (provider === 'own' && ['bp.zicotv.cc', 'zicotv.cc'].includes(url.hostname)
      && /^\/api\/player\/\d+\/?$/.test(url.pathname)) return true;
    return !source.is_premium && !source.locked && ['direct', 'iframe'].includes(source.type);
  };
  return sources.some(source => playable(source, source?.source)
    || (!source?.is_premium && !source?.locked && Array.isArray(source?.streams)
      && source.streams.some(stream => playable(stream, stream?.source || source.source))));
}

const sportNames = { Soccer: 'Fútbol', Basketball: 'Baloncesto', Tennis: 'Tenis',
  'Ice Hockey': 'Hockey sobre hielo', Handball: 'Balonmano', Volleyball: 'Voleibol',
  Motorsport: 'Motor', Futsal: 'Fútbol sala', Cycling: 'Ciclismo', Fighting: 'Combate', Other: 'Otros deportes' };

const MATCH_TOLERANCE = 15 * 60000;
const competitionNames = new Map(COMPETITIONS.flatMap(c => [c.name, ...c.aliases].map(name => [key(name), c.slug])));
const competitionCodes = new Set(COMPETITIONS.map(c => c.slug));
const linkedCompetitions = new Set(['esp.1', 'esp.2', 'esp.w.1', 'uefa.champions',
  'uefa.europa', 'uefa.europa.conf', 'esp.copa_del_rey']);
const ambiguousLeagueNames = new Set(['primera division', 'segunda division', 'primera division femenina',
  'supercopa', 'league cup', 'calcio', 'serie a', 'premier', 'bundesliga', 'champions', 'euro', 'mundial']);
const feedCompetitionNames = new Map(Object.entries({
  'spanish la liga': 'esp.1', 'spanish la liga 2': 'esp.2', 'spanish liga f': 'esp.w.1',
  'spanish copa del rey': 'esp.copa_del_rey', 'europa conference league': 'uefa.europa.conf',
  'uefa europa conference league': 'uefa.europa.conf',
  'english premier league': 'eng.1', 'italian serie a': 'ita.1', 'german bundesliga': 'ger.1',
  'french ligue 1': 'fra.1', 'portuguese primeira liga': 'por.1', 'dutch eredivisie': 'ned.1',
  'american major league soccer': 'usa.1', 'argentinian primera division': 'arg.1',
  'brazilian serie a': 'bra.1', 'saudi arabian pro league': 'sau.1',
}));
const competitionRegions = {
  esp: ['espana', 'spain'], eng: ['inglaterra', 'england'], ita: ['italia', 'italy'],
  ger: ['alemania', 'germany'], fra: ['francia', 'france'], por: ['portugal'],
  ned: ['paises bajos', 'holanda', 'netherlands'], usa: ['ee uu', 'estados unidos', 'united states', 'usa'],
  mex: ['mexico'], arg: ['argentina'], bra: ['brasil', 'brazil'], sau: ['arabia saudi', 'saudi arabia'],
  uefa: ['europa', 'europe', 'uefa'], fifa: ['mundo', 'world', 'fifa'],
  conmebol: ['sudamerica', 'south america', 'conmebol'],
};
function sourceLeague(name) {
  const label = key(name);
  const parts = clean(name).split(':');
  const region = parts.length > 1 ? key(parts[0]) : '';
  const direct = feedCompetitionNames.get(label) || competitionNames.get(label);
  const tail = region ? competitionNames.get(key(parts.at(-1))) : undefined;
  const validRegion = parts.length === 2 && competitionRegions[tail?.split('.')[0]]?.includes(region);
  const league = (!ambiguousLeagueNames.has(label) && direct) || (validRegion ? tail : label);
  return { league, region, formerAlias: league === (direct || tail) ? undefined : (direct || tail) };
}
const leagueKey = name => sourceLeague(name).league;
const normalizedTeam = name => key(name)
  .replace(/\b(?:f c|a f c|fc|cf|afc|cd|ud|sk|fk|sc|sv|aif|and|de|del)\b/g, ' ')
  .replace(/\brb\b/g, 'red bull').replace(/\bst\b/g, 'saint')
  .replace(/\bkobenhavn\b/g, 'copenhagen').replace(/\s+/g, ' ').trim();
const teamKey = (name, league) => {
  const normalized = normalizedTeam(name);
  const club = league === 'esp.w.1' ? normalized.replace(/ (?:women|femenin[oa]|femeni|fem|w)$/, '') : normalized;
  return league?.startsWith('esp.') && /^athletic (?:bilbao|club bilbao)$/.test(club) ? 'athletic club' : club;
};
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
  if (!sameLeague && competitionCodes.has(candidate.league)
      && (competitionCodes.has(match.league) || (match.region && !competitionRegions[candidate.league.split('.')[0]]?.includes(match.region)))) return null;
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
  const teamsById = new Map(teams.map(team => [team.id, team.name]));
  const manual = [...existing, ...fixtures.map(fixture => fixtureEvent(fixture, catalog))].map(event => {
    const league = leaguesById.get(event.leagueId);
    const manualLinks = (event.streams || []).filter(link => !event.zicoStreams?.includes(link));
    const manualEventIds = new Set(manualLinks.map(link => zicoEventApi(link)?.split('/').at(-1)));
    return { id: event.id, name: key(event.name), start: Date.parse(event.startAt), league,
      home: teamKey(teamsById.get(event.homeTeamId), league), away: teamKey(teamsById.get(event.awayTeamId), league),
      manualEventIds, automaticEventId: event.zicoEventId };
  });
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

    const zicoId = String(row.id);
    const { league, region, formerAlias } = sourceLeague(row.league);
    const details = { start, league, region, name: key(name), home: teamKey(row.home_team, league), away: teamKey(row.away_team, league) };
    const explicit = manual.filter(candidate => candidate.manualEventIds.has(zicoId)
      || (candidate.automaticEventId === zicoId && (!linkedCompetitions.has(league) || candidate.league === league)));
    const ranked = explicit.length ? [] : manual.map(candidate => matchCandidate(candidate, details))
      .filter(Boolean).sort((a, b) => b.score - a.score || a.distance - b.distance);
    const [best, second] = ranked;
    const tied = second && best.score === second.score && best.distance === second.distance;
    const target = explicit.length === 1 ? explicit[0] : !explicit.length && !tied ? best?.candidate : null;
    const old = previous.get(id);
    const available = hasZicoSource(row);
    const page = `${ORIGIN}/events/${row.id}`;
    const zicoStreams = available ? [page] : [];
    if (target || explicit.length || ranked.length) {
      if (target && available) {
        const previousLink = assigned.get(target.id);
        // League rows take precedence over duplicate broadcaster listings for these fixtures.
        const priority = linkedCompetitions.has(target.league)
          ? (target.manualEventIds.has(zicoId) ? 2 : target.league === league ? 1 : 0) : 0;
        if (!previousLink || priority > previousLink.priority) {
          assigned.set(target.id, { zicoEventId: zicoId, zicoStreams, priority });
          if (!previousLink) linked++;
        }
      }
      if (!available) skipped++;
      continue;
    }
    const manualStreams = (old?.streams || []).filter(url => url !== page && !old.zicoStreams?.includes(url));
    const channel = channels.get(old?.channelId);
    if (!available && ![...manualStreams, ...(channel?.streams || [])].some(url => !zicoEventApi(url))) {
      skipped++;
      continue;
    }
    occupied.add(match);
    const streams = [...new Set([...zicoStreams, ...manualStreams])].slice(0, 50);
    const competition = clean(row.league) || sportNames[row.sport_category] || clean(row.sport_category);
    const existingLeague = row.sport_category === 'Soccer' && league
      ? leagues.find(item => !item.id.startsWith('zico-liga-') && leaguesById.get(item.id) === league) : null;
    // Undo previous automatic matches that used the division name and ignored a foreign country.
    const oldLeague = row.sport_category === 'Soccer' && formerAlias && leaguesById.get(old?.leagueId) === formerAlias
      ? '' : old?.leagueId;
    const leagueId = existingLeague?.id || oldLeague || addEntity(leagues, competition, null, 'zico-liga-', true);
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
  // Expired agenda entries are replaced above. Their generated teams and leagues must also
  // leave the catalog, while manual entities and those adopted by ESPN stay available.
  const matches = [...data.events, ...(data.fixtures || [])];
  const usedTeams = new Set(matches.flatMap(item => [item.homeTeamId, item.awayTeamId]));
  data.teams = teams.filter(team => !team.id.startsWith('zico-equipo-') || team.espnId || usedTeams.has(team.id));
  const usedLeagues = new Set([...matches, ...data.teams].map(item => item.leagueId));
  const removedLeagues = new Set(leagues.filter(league => league.id.startsWith('zico-liga-')
    && !league.espn && !usedLeagues.has(league.id)).map(league => league.id));
  data.leagues = leagues.filter(league => !removedLeagues.has(league.id));
  if (Array.isArray(data.leagueOrder)) data.leagueOrder = data.leagueOrder.filter(id => !removedLeagues.has(id));
  return { data, count, skipped, linked };
}
