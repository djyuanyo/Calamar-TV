/**
 * Imported competitions: a Google link of a league (for example share.google/… of «LaLiga») becomes
 * the league, its teams with their crests and its upcoming matches («fixtures» in the catalog), each
 * with its Google link for statistics. Kick-off times and teams come from ESPN's season calendar.
 * Fixtures live apart from `events` so apps that do not know them keep reading the catalog.
 */
import { googleSearchFor, googleMatchUrl, MATCH_RESOLVER } from './match-scores.js';
const API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
/** ESPN code, Spanish name and the names Google may use for it (without accents, lower case). */
export const COMPETITIONS = [
  ['esp.1', 'LaLiga', ['laliga', 'la liga', 'laliga ea sports', 'liga espanola', 'primera division', 'liga de espana', 'primera division de espana']],
  ['esp.2', 'LaLiga Hypermotion', ['laliga hypermotion', 'hypermotion', 'laliga 2', 'segunda division', 'liga smartbank']],
  ['esp.copa_del_rey', 'Copa del Rey', ['copa del rey']],
  ['esp.super_cup', 'Supercopa de España', ['supercopa de espana', 'supercopa']],
  ['esp.w.1', 'Liga F', ['liga f', 'primera division femenina']],
  ['eng.1', 'Premier League', ['premier league', 'premier', 'liga inglesa']],
  ['eng.fa', 'FA Cup', ['fa cup', 'copa fa']],
  ['eng.league_cup', 'Carabao Cup', ['carabao cup', 'efl cup', 'copa de la liga inglesa']],
  ['ita.1', 'Serie A', ['serie a', 'liga italiana', 'calcio']],
  ['ger.1', 'Bundesliga', ['bundesliga', 'liga alemana']],
  ['fra.1', 'Ligue 1', ['ligue 1', 'liga francesa']],
  ['por.1', 'Liga Portugal', ['liga portugal', 'primeira liga', 'liga portuguesa']],
  ['ned.1', 'Eredivisie', ['eredivisie', 'liga neerlandesa']],
  ['uefa.champions', 'Champions League', ['champions league', 'liga de campeones', 'champions', 'uefa champions league']],
  ['uefa.europa', 'Europa League', ['europa league', 'uefa europa league']],
  ['uefa.europa.conf', 'Conference League', ['conference league', 'uefa conference league']],
  ['uefa.nations', 'Nations League', ['nations league', 'liga de naciones']],
  ['uefa.euro', 'Eurocopa', ['eurocopa', 'euro']],
  ['fifa.world', 'Mundial', ['mundial', 'copa mundial', 'copa del mundo', 'world cup']],
  ['conmebol.libertadores', 'Copa Libertadores', ['libertadores', 'copa libertadores']],
  ['usa.1', 'MLS', ['mls', 'major league soccer']],
  ['mex.1', 'Liga MX', ['liga mx', 'liga mexicana']],
  ['arg.1', 'Liga Profesional Argentina', ['liga profesional', 'liga argentina', 'primera division argentina']],
  ['bra.1', 'Brasileirão', ['brasileirao', 'serie a brasil', 'liga brasilena']],
  ['sau.1', 'Saudi Pro League', ['saudi pro league', 'liga saudi', 'liga de arabia']],
].map(([slug, name, aliases]) => ({ slug, name, aliases }));
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** The competition a Google search names: the longest matching name wins («laliga hypermotion» over «laliga»). */
export function detectCompetition(query) {
  const text = ` ${normal(query)} `;
  let best = null, length = 0;
  for (const c of COMPETITIONS) for (const alias of c.aliases) {
    if (text.includes(` ${alias} `) && alias.length > length) { best = c; length = alias.length; }
  }
  return best;
}

/** The competition of a Google link (share.google links are opened by the hosting, like matches). */
export async function competitionFromLink(value, fetcher = globalThis.fetch) {
  let google = googleMatchUrl(value);
  if (new URL(google).hostname === 'share.google') {
    let data;
    try {
      const r = await fetcher(`${MATCH_RESOLVER}?url=${encodeURIComponent(google)}`, { signal: AbortSignal.timeout(15000), referrerPolicy: 'no-referrer' });
      if (!r.ok) throw Error();
      data = await r.json();
    } catch { throw Error('No se pudo abrir el enlace corto. Comprueba que calamar-match.php esté subido al hosting, o elige la competición de la lista.'); }
    google = googleMatchUrl(data.url);
  }
  const query = new URL(google).searchParams.get('q') || '';
  return { query, competition: detectCompetition(query) };
}

const DAY = 86400000;
/**
 * «Jornada N» of every match. ESPN does not say it, so it comes from the calendar: matches a few days
 * apart in which no team plays twice form a round. A lone match between rounds, or one too many in a
 * round, is a postponed one and takes the oldest round both teams still owe.
 */
export function assignRounds(matches) {
  const sorted = [...matches].sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || String(a.id).localeCompare(String(b.id)));
  const clusters = [];
  for (const m of sorted) {
    const last = clusters[clusters.length - 1], at = Date.parse(m.date);
    if (last && at <= last.start + 4.5 * DAY && !last.teams.has(m.home) && !last.teams.has(m.away)) last.matches.push(m);
    else clusters.push({ start: at, matches: [m], teams: new Set() });
    clusters[clusters.length - 1].teams.add(m.home).add(m.away);
  }
  const teams = new Set(sorted.flatMap((m) => [m.home, m.away]));
  const half = Math.max(1, Math.floor(teams.size / 2)), regular = Math.max(2, Math.floor(teams.size / 4));
  const rounds = [], out = new Map();
  const owed = (m, except) => rounds.find((r) => r !== except && !r.has(m.home) && !r.has(m.away));
  const put = (m, round) => { round.add(m.home); round.add(m.away); out.set(m.id, rounds.indexOf(round) + 1); };
  for (const cluster of clusters) {
    if (cluster.matches.length >= regular) {
      const round = new Set();
      rounds.push(round);
      let extra = cluster.matches.length - half;
      for (const m of cluster.matches) {
        const older = extra > 0 ? owed(m, round) : null;
        if (older) { put(m, older); extra--; } else put(m, round);
      }
    } else for (const m of cluster.matches) {
      let round = owed(m);
      if (!round) rounds.push(round = new Set());
      put(m, round);
    }
  }
  return out;
}

/** Season label: «2026/2027», or the single year of a competition played within one year. */
export function seasonName(season) {
  const year = Number(season?.year), start = Date.parse(season?.startDate), end = Date.parse(season?.endDate);
  if (!Number.isInteger(year)) return '';
  return Number.isFinite(start) && Number.isFinite(end) && new Date(start).getUTCFullYear() === new Date(end - DAY).getUTCFullYear() ? String(year) : `${year}/${year + 1}`;
}

/** Turns ESPN's boards of the season into the league, its teams and its matches. */
export function parseSeason(boards, slug) {
  const league = boards.find((b) => b?.leagues?.[0])?.leagues[0];
  if (!league) throw Error('ESPN no tiene el calendario de esta competición.');
  const season = league.season || {}, year = season.year, teams = new Map(), seen = new Set(), matches = [];
  for (const board of boards) for (const e of board?.events || []) {
    if (seen.has(e.id) || (year !== undefined && e.season?.year !== undefined && e.season.year !== year)) continue;
    seen.add(e.id);
    const c = e.competitions?.[0], side = (s) => c?.competitors?.find((t) => t.homeAway === s)?.team;
    const home = side('home'), away = side('away');
    if (!home?.id || !away?.id || !/^\d{1,20}$/.test(String(e.id)) || !Number.isFinite(Date.parse(e.date))) continue;
    for (const t of [home, away]) teams.set(String(t.id), { espnId: String(t.id), name: t.displayName || t.name || t.shortDisplayName || 'Equipo', logo: /^https:\/\//.test(t.logo || '') ? t.logo : '' });
    const state = c.status?.type || e.status?.type || {};
    matches.push({ id: String(e.id), date: new Date(e.date).toISOString(), home: String(home.id), away: String(away.id), done: !!state.completed || /CANCEL/.test(state.name || '') });
  }
  if (!matches.length) throw Error('ESPN no tiene partidos de esta temporada todavía.');
  const known = COMPETITIONS.find((c) => c.slug === slug);
  const logo = (league.logos || []).find((l) => (l.rel || []).includes('default'))?.href || league.logos?.[0]?.href || '';
  return { slug, name: known?.name || league.name || slug, logo: /^https:\/\//.test(logo) ? logo : '', season: seasonName(season), teams: [...teams.values()], matches };
}

async function board(url, fetcher) {
  const r = await fetcher(url, { signal: AbortSignal.timeout(20000), referrerPolicy: 'no-referrer' });
  if (!r.ok) throw Error(`ESPN no responde (HTTP ${r.status}).`);
  return r.json();
}
/** The whole current season of a competition. ESPN answers by calendar year, so both years are read. */
export async function fetchSeason(slug, fetcher = globalThis.fetch) {
  if (!COMPETITIONS.some((c) => c.slug === slug)) throw Error('Elige una competición de la lista.');
  const now = await board(`${API}${slug}/scoreboard`, fetcher);
  const season = now?.leagues?.[0]?.season || {};
  const first = new Date(Date.parse(season.startDate) || Date.now()).getUTCFullYear();
  const last = new Date((Date.parse(season.endDate) || Date.now()) - DAY).getUTCFullYear();
  const boards = [now];
  for (let y = first; y <= Math.max(first, last) && y <= first + 1; y++) boards.push(await board(`${API}${slug}/scoreboard?dates=${y}&limit=1000`, fetcher));
  return parseSeason(boards, slug);
}

const used = (data) => new Set([...(data.leagues || []), ...(data.teams || [])].map((x) => x.id));
/**
 * Adds or refreshes an imported competition in the catalog (a copy is returned). Existing teams are
 * reused by their ESPN number or name; fixtures keep the channel, cover and anything set by hand, and
 * only their date and round follow ESPN. Matches already played are left out to keep the catalog small.
 */
export function applySeason(data, season, now = Date.now()) {
  const next = { ...data, leagues: [...(data.leagues || [])], teams: [...(data.teams || [])], fixtures: [...(data.fixtures || [])] };
  const ids = used(next);
  const uniqueId = (base) => { let id = base; for (let n = 2; ids.has(id); n++) id = `${base}-${n}`; ids.add(id); return id; };
  let league = next.leagues.find((l) => l.espn === season.slug);
  if (league) {
    league = { ...league, season: season.season || league.season, logo: league.logo || season.logo };
    next.leagues = next.leagues.map((l) => (l.espn === season.slug ? league : l));
  } else {
    league = { id: uniqueId(`espn-${season.slug}`), name: season.name, logo: season.logo, espn: season.slug, season: season.season };
    next.leagues.push(league);
  }
  const teamOf = new Map();
  for (const t of season.teams) {
    let team = next.teams.find((x) => x.espnId === t.espnId) || next.teams.find((x) => !x.espnId && normal(x.name) === normal(t.name));
    if (team) {
      if (!team.espnId || !team.logo) { const updated = { ...team, espnId: t.espnId, logo: team.logo || t.logo }; next.teams = next.teams.map((x) => (x === team ? updated : x)); team = updated; }
    } else {
      team = { id: uniqueId(`espn-${t.espnId}`), name: t.name, logo: t.logo, espnId: t.espnId, leagueId: league.id };
      next.teams.push(team);
    }
    teamOf.set(t.espnId, team.id);
  }
  const rounds = assignRounds(season.matches);
  const kept = new Map(next.fixtures.map((f) => [f.matchId, f]));
  const fresh = new Set();
  for (const m of season.matches) {
    if (m.done || Date.parse(m.date) < now - 6 * 3600000) continue;
    fresh.add(m.id);
    const old = kept.get(m.id);
    const fixture = { ...(old || { id: `partido-${m.id}` }), leagueId: league.id, homeTeamId: teamOf.get(m.home), awayTeamId: teamOf.get(m.away),
      startAt: m.date, round: `Jornada ${rounds.get(m.id)}`, matchId: m.id };
    if (fixture.matchDate) fixture.matchDate = m.date;
    if (old) next.fixtures = next.fixtures.map((f) => (f === old ? fixture : f));
    else next.fixtures.push(fixture);
  }
  // Played matches of this league go; so do those ESPN no longer lists, unless a channel was set.
  next.fixtures = next.fixtures.filter((f) => f.leagueId !== league.id || fresh.has(f.matchId) || (f.channelId && Date.parse(f.startAt) > now - 6 * 3600000));
  return { data: next, league, count: fresh.size };
}

/** A fixture as an event: its name and Google link come from its teams. */
export function fixtureEvent(fixture, data) {
  const team = (id) => (data?.teams || []).find((t) => t.id === id);
  const league = (data?.leagues || []).find((l) => l.id === fixture.leagueId);
  const home = team(fixture.homeTeamId)?.name || 'Local', away = team(fixture.awayTeamId)?.name || 'Visitante';
  return { season: league?.season || '', ...fixture, name: fixture.name || `${home} vs ${away}`, matchUrl: fixture.matchUrl || googleSearchFor(home, away),
    matchDate: fixture.matchDate || fixture.startAt, cover: fixture.cover || '', channelId: fixture.channelId || '', imported: true };
}

/** Monday of the Madrid week of a date, as «YYYY-MM-DD». */
export function madridWeek(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const day = Date.UTC(+p.year, +p.month - 1, +p.day);
  return new Date(day - ((new Date(day).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
}
/** A match counts as over this long after kick-off when ESPN has not said it ended. */
export const MATCH_SPAN_MS = 4 * 3600000;
/**
 * Imported matches shown to viewers: those of the Monday-to-Sunday week of each league's next match,
 * so when the last one of the week ends, the next week's appear. Matches already over are left out.
 */
export function weekFixtures(list, now = Date.now()) {
  const live = list.filter((e) => Date.parse(e.startAt) + MATCH_SPAN_MS > now);
  const week = new Map();
  for (const e of live) {
    const key = madridWeek(e.startAt);
    if (!week.has(e.leagueId) || key < week.get(e.leagueId)) week.set(e.leagueId, key);
  }
  return live.filter((e) => madridWeek(e.startAt) === week.get(e.leagueId));
}

/** Checks the imported matches; `teams`, `leagues` and `channels` are the sets of valid ids. */
export function validateFixtures(data, { leagues, teams, channels, eventIds, imageValid }) {
  if (data.fixtures === undefined) return;
  if (!Array.isArray(data.fixtures) || data.fixtures.length > 3000) throw Error('La lista de partidos importados no es válida.');
  const ids = new Set();
  for (const f of data.fixtures) {
    if (!f || typeof f.id !== 'string' || !f.id || ids.has(f.id) || eventIds.has(f.id)) throw Error('Hay un partido importado repetido.');
    ids.add(f.id);
    if (!leagues.has(f.leagueId) || !teams.has(f.homeTeamId) || !teams.has(f.awayTeamId) || f.homeTeamId === f.awayTeamId) throw Error('La liga o los equipos de un partido importado no existen.');
    if (typeof f.startAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(f.startAt) || !Number.isFinite(Date.parse(f.startAt))) throw Error('La fecha de un partido importado no es válida.');
    if (!/^\d{1,20}$/.test(f.matchId || '')) throw Error('Un partido importado no tiene su número de ESPN.');
    if (f.matchUrl) googleMatchUrl(f.matchUrl);
    if (f.channelId && !channels.has(f.channelId)) throw Error('El canal de un partido importado no existe.');
    if (f.cover && !imageValid(f.cover)) throw Error('La portada de un partido importado no es válida.');
    if (f.name !== undefined && (typeof f.name !== 'string' || !f.name.trim())) throw Error('El nombre de un partido importado no es válido.');
    for (const key of ['round', 'season', 'venue', 'description', 'status']) if (f[key] !== undefined && (typeof f[key] !== 'string' || f[key].length > 4000)) throw Error('Los detalles de un partido importado no son válidos.');
    if (f.featured !== undefined && typeof f.featured !== 'boolean') throw Error('Destacado no válido.');
  }
}
