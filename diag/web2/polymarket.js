// What Polymarket's market expects of a match: the chances of a home win, a draw and an away win, from
// its public API (gamma-api.polymarket.com, open to any origin). Only read: nothing is bet from here.
// The match is found by its kick-off (Polymarket's football events end at kick-off) and its teams.
export const POLYMARKET_API = 'https://gamma-api.polymarket.com';
const SOCCER_TAG = 100350;

/** Lower case, without accents or punctuation, without «FC», «CF», «de»…: names from ESPN and Polymarket compare. */
export function teamWords(name) {
  const common = new Set(['fc', 'cf', 'cd', 'ud', 'sd', 'ac', 'as', 'afc', 'sc', 'ss', 'ssc', 'club', 'de', 'del', 'la', 'el', 'the', 'calcio', 'football', 'futbol', 'sad', 'cp', 'rc', 'rcd', 'sv', 'vfb', 'vfl', 'fk', 'sk', 'if', 'bk']);
  return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter((w) => w && !common.has(w));
}

/** How well two team names match: 0 none, more is better. «Real» alone is not a match. */
export function teamScore(a, b) {
  const x = teamWords(a), y = teamWords(b);
  if (!x.length || !y.length) return 0;
  if (x.join(' ') === y.join(' ')) return 10;
  const shared = x.filter((w) => y.includes(w));
  let score = shared.length;
  const jx = x.join(''), jy = y.join('');
  if (jx.length > 3 && jy.length > 3 && (jx.includes(jy) || jy.includes(jx))) score += 2;
  if (shared.length === 1 && score === 1 && ['real', 'atletico', 'sporting', 'united', 'city', 'inter', 'athletic', 'racing', 'deportivo'].includes(shared[0])) return 0;
  return score;
}

const bestTeam = (team, name) => Math.max(teamScore(name, team?.name), teamScore(name, team?.alias));

/** The match's 1X2 from a Polymarket event: { home, draw, away } in % adding up to 100, its volume and page. */
export function eventOdds(event) {
  const markets = (event?.markets || []).filter((m) => m.sportsMarketType === 'moneyline' && !m.closed);
  const teams = event?.teams || [];
  const homeTeam = teams.find((t) => t.ordering === 'home') || teams[0], awayTeam = teams.find((t) => t.ordering === 'away') || teams[1];
  if (markets.length < 3 || !homeTeam || !awayTeam) return null;
  const yes = (m) => { try { const p = Number(JSON.parse(m.outcomePrices)[0]); return Number.isFinite(p) ? p : NaN; } catch { return NaN; } };
  const draw = markets.find((m) => /draw/i.test(m.groupItemTitle || m.question || ''));
  const side = (team) => markets.find((m) => m !== draw && (m.groupItemTitle === team.name || teamScore(m.groupItemTitle, team.name) >= 2));
  const home = side(homeTeam), away = side(awayTeam);
  if (!draw || !home || !away) return null;
  const raw = [yes(home), yes(draw), yes(away)];
  const total = raw.reduce((a, b) => a + b, 0);
  if (!raw.every((p) => p >= 0) || !(total > 0)) return null;
  // Rounded so the three add up to exactly 100.
  const exact = raw.map((p) => (p / total) * 100), pct = exact.map(Math.floor);
  for (const i of exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).slice(0, 100 - pct.reduce((a, b) => a + b, 0))) pct[i[1]]++;
  const volume = markets.reduce((sum, m) => sum + (Number(m.volume) || 0), 0);
  return { home: pct[0], draw: pct[1], away: pct[2], homeName: homeTeam.name, awayName: awayTeam.name, volume, url: `https://polymarket.com/event/${event.slug}` };
}

/** Among Polymarket's football events around kick-off, the one of this match (teams in either order), or null. */
export function pickEvent(events, home, away) {
  let best = null, bestScore = 0;
  for (const e of events || []) {
    if (/ - /.test(e.title || '') || !(e.markets || []).some((m) => m.sportsMarketType === 'moneyline')) continue;
    const teams = e.teams || [];
    const h = teams.find((t) => t.ordering === 'home') || teams[0], a = teams.find((t) => t.ordering === 'away') || teams[1];
    if (!h || !a) continue;
    const same = Math.min(bestTeam(h, home), bestTeam(a, away));
    const swapped = Math.min(bestTeam(h, away), bestTeam(a, home));
    const score = Math.max(same, swapped ? swapped - 0.5 : 0);
    if (score > bestScore) { best = { event: e, swapped: swapped > same }; bestScore = score; }
  }
  return best;
}

/** Polymarket's odds of a match (home and away as in our event), or null when it has none open. */
export async function fetchOdds(home, away, kickoff, fetcher = globalThis.fetch) {
  const at = Date.parse(kickoff);
  if (!home || !away || !Number.isFinite(at)) return null;
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const query = new URLSearchParams({ tag_id: String(SOCCER_TAG), closed: 'false', limit: '100',
    end_date_min: iso(at - 3 * 3600000), end_date_max: iso(at + 3 * 3600000) });
  const response = await fetcher(`${POLYMARKET_API}/events?${query}`, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response.ok) return null;
  const found = pickEvent(await response.json(), home, away);
  const odds = found && eventOdds(found.event);
  if (!odds) return null;
  return found.swapped ? { ...odds, home: odds.away, away: odds.home, homeName: odds.awayName, awayName: odds.homeName } : odds;
}
