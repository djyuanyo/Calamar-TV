// The match under the video of an event: General (timeline, key figures, incidents, form and details),
// Estadísticas, Alineaciones and H2H. With a Google match link the data comes from ESPN's summary of
// the match (the same source as the score on the cards); without one, from the event itself.
import { matchResult } from './match-scores.js';

const logoOf = (team) => team?.logo || team?.logos?.[0]?.href || '';
const valid = (url) => /^https:\/\//.test(url || '') || /^data:image\//.test(url || '') ? url : '';

// ESPN's statistic names, in the order and with the names they are shown in.
const STATS = [
  ['possessionPct', 'Posesión', '%'], ['totalShots', 'Tiros'], ['shotsOnTarget', 'Tiros a puerta'], ['wonCorners', 'Córners'],
  ['foulsCommitted', 'Faltas'], ['offsides', 'Fueras de juego'], ['yellowCards', 'Tarjetas amarillas'], ['redCards', 'Tarjetas rojas'],
  ['saves', 'Paradas'], ['totalPasses', 'Pases'], ['accuratePasses', 'Pases completados'], ['passPct', 'Precisión de pase', '%'],
  ['totalCrosses', 'Centros'], ['totalLongBalls', 'Balones largos'], ['blockedShots', 'Tiros bloqueados'], ['totalTackles', 'Entradas'],
  ['interceptions', 'Intercepciones'], ['totalClearance', 'Despejes'],
];

function eventKind(e) {
  const t = `${e.type?.type || ''} ${e.type?.text || ''}`.toLowerCase();
  if (/own.?goal|propia/.test(t)) return 'own-goal';
  if (/penalty.*(miss|saved|fallad)/.test(t)) return 'penalty-missed';
  if (/penalty|penalti/.test(t) && (e.scoringPlay || /scored|goal/.test(t))) return 'penalty';
  if (e.scoringPlay || /goal|gol/.test(t)) return 'goal';
  if (/red|roja|second yellow/.test(t)) return 'red';
  if (/yellow|amarilla/.test(t)) return 'yellow';
  if (/substitution|cambio/.test(t)) return 'sub';
  return '';
}
/** «45'+2'» is minute 47; «67'» is 67. */
export const minuteOf = (text) => (String(text || '').match(/\d+/g) || []).slice(0, 2).reduce((a, b) => a + Number(b), 0);

/** Turns ESPN's summary into what the tabs show; anything ESPN leaves out is simply not shown. */
export function parseMatchCenter(data) {
  const header = data.header || {}, competition = header.competitions?.[0] || {};
  const result = matchResult(data);
  const sideOf = (team) => {
    const c = (competition.competitors || []).find((x) => (team?.id && String(x.team?.id) === String(team.id)) || (team?.displayName && x.team?.displayName === team.displayName));
    return c?.homeAway === 'away' ? 'away' : c?.homeAway === 'home' ? 'home' : '';
  };
  const team = (homeAway) => {
    const c = (competition.competitors || []).find((x) => x.homeAway === homeAway) || {};
    const score = typeof c.score === 'object' ? c.score?.displayValue : c.score;
    return { id: String(c.team?.id || ''), name: c.team?.displayName || c.team?.name || '', short: c.team?.abbreviation || '',
      logo: valid(logoOf(c.team)), score: /^\d+$/.test(String(score ?? '')) ? String(score) : '' };
  };
  const home = team('home'), away = team('away');
  const events = (data.keyEvents || []).map((e) => {
    const kind = eventKind(e);
    if (!kind) return null;
    const people = (e.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
    return { kind, minute: e.clock?.displayValue || '', side: sideOf(e.team), player: people[0] || '', other: people[1] || '' };
  }).filter(Boolean);
  const byName = (teamEntry) => Object.fromEntries((teamEntry?.statistics || []).map((s) => [s.name, s]));
  const boxTeams = data.boxscore?.teams || [];
  const homeBox = byName(boxTeams.find((t) => sideOf(t.team) === 'home') || boxTeams[0]);
  const awayBox = byName(boxTeams.find((t) => sideOf(t.team) === 'away') || boxTeams[1]);
  const number = (v) => Number.parseFloat(String(v ?? '').replace(',', '.')) || 0;
  const stats = STATS.map(([key, label, unit = '']) => {
    const h = homeBox[key]?.displayValue, a = awayBox[key]?.displayValue;
    if (h == null && a == null) return null;
    const hv = number(h), av = number(a), total = hv + av;
    return { key, label, home: `${h ?? '0'}${unit && !String(h ?? '').includes('%') ? unit : ''}`, away: `${a ?? '0'}${unit && !String(a ?? '').includes('%') ? unit : ''}`,
      homeValue: hv, awayValue: av, share: total > 0 ? hv / total : 0.5 };
  }).filter(Boolean);
  const lineups = ['home', 'away'].map((side) => {
    const r = (data.rosters || []).find((x) => x.homeAway === side);
    if (!r?.roster?.length) return null;
    const player = (p) => ({ number: p.jersey || '', name: p.athlete?.displayName || p.athlete?.shortName || '', position: p.position?.abbreviation || '',
      subbedIn: !!p.subbedIn, subbedOut: !!p.subbedOut });
    const sorted = [...r.roster].sort((a, b) => (Number(a.formationPlace) || 99) - (Number(b.formationPlace) || 99));
    return { side, team: side === 'home' ? home : away, formation: r.formation || '',
      starters: sorted.filter((p) => p.starter).map(player), subs: sorted.filter((p) => !p.starter).map(player) };
  }).filter(Boolean);
  // Last results of each team (W, D, L) and earlier meetings between them.
  const form = { home: [], away: [] };
  // ESPN moved the teams' last results from boxscore.form to lastFiveGames (same shape).
  for (const f of (data.boxscore?.form?.length ? data.boxscore.form : data.lastFiveGames) || []) {
    const side = sideOf(f.team);
    if (side) form[side] = (f.events || []).slice(0, 5).map((e) => ({ result: String(e.gameResult || '').toUpperCase().slice(0, 1), score: e.score || '',
      opponent: e.opponent?.displayName || '', date: e.gameDate || '' })).filter((e) => /[WDLEVGP]/.test(e.result));
  }
  const meetings = new Map();
  for (const block of data.headToHeadGames || []) {
    const own = block.team || {};
    for (const g of block.events || []) {
      const key = g.id || `${g.gameDate}${g.score}`;
      if (meetings.has(key)) continue;
      const ownHome = String(g.homeTeamId || '') === String(own.id || '') || (g.atVs || 'vs') === 'vs';
      const names = [own.displayName || '', g.opponent?.displayName || ''];
      const [hName, aName] = ownHome ? names : names.reverse();
      const scores = String(g.score || '').match(/\d+/g) || [];
      const hScore = g.homeTeamScore ?? scores[ownHome ? 0 : 1] ?? '', aScore = g.awayTeamScore ?? scores[ownHome ? 1 : 0] ?? '';
      meetings.set(key, { date: g.gameDate || '', competition: g.leagueName || g.leagueAbbreviation || '', home: hName, away: aName, score: hScore !== '' && aScore !== '' ? `${hScore} – ${aScore}` : g.score || '' });
    }
  }
  // Now ESPN sends the last meetings, in any competition, as seasonseries (also before the match starts).
  for (const series of data.seasonseries || []) {
    for (const g of series.events || []) {
      if (meetings.has(g.id) || g.statusType?.completed === false || g.status === 'pre') continue;
      const side = (where) => (g.competitors || []).find((c) => c.homeAway === where) || {};
      const h = side('home'), a = side('away');
      if (!h.team || !a.team) continue;
      meetings.set(g.id, { date: g.date || '', competition: [g.competitionName, g.roundName].filter(Boolean).join(' · '),
        home: h.team.displayName || '', away: a.team.displayName || '', score: h.score != null && a.score != null && h.score !== '' ? `${h.score} – ${a.score}` : '' });
    }
  }
  const h2h = [...meetings.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 10);
  const info = data.gameInfo || {};
  const venue = info.venue || competition.venue || {};
  const referee = (info.officials || []).find((o) => /referee|árbitro/i.test(o.position?.displayName || o.position?.name || '')) || info.officials?.[0];
  return {
    id: result.id, state: result.state, status: result.text, clock: result.clock, live: result.live, home, away,
    league: header.league?.name || header.league?.abbreviation || '', round: competition.notes?.[0]?.headline || '',
    date: competition.date || header.date || '', venue: venue.fullName || '', city: [venue.address?.city, venue.address?.country].filter(Boolean).join(', '),
    attendance: Number(info.attendance) > 0 ? Number(info.attendance) : 0, referee: referee?.displayName || referee?.fullName || '',
    events, stats, lineups, form, h2h, description: '', source: 'espn',
  };
}

/** The event's own data (teams, league, date, place, description), for events without ESPN data. */
export function eventMatchModel(c, custom, status = '') {
  const find = (list, id) => (custom?.[list] || []).find((x) => x.id === id);
  const home = find('teams', c.homeTeamId), away = find('teams', c.awayTeamId), league = find('leagues', c.leagueId);
  const [nameHome, nameAway] = String(c.name || '').split(/\s+(?:vs\.?|v|contra|-|–)\s+/i);
  const team = (t, fallback) => ({ id: '', name: t?.name || fallback || '', short: '', logo: valid(t?.logo), score: '' });
  return { id: '', state: 'scheduled', status, clock: '', live: false, home: team(home, nameHome || c.name), away: team(away, nameAway || ''),
    league: league?.name || '', round: [c.round, c.season].filter(Boolean).join(' · '), date: c.startAt || '', venue: c.venue || '', city: '',
    attendance: 0, referee: '', events: [], stats: [], lineups: [], form: { home: [], away: [] }, h2h: [], description: c.description || '', source: 'event' };
}

const KIND = { goal: 'Gol', penalty: 'Gol de penalti', 'own-goal': 'Gol en propia puerta', 'penalty-missed': 'Penalti fallado', yellow: 'Tarjeta amarilla', red: 'Tarjeta roja', sub: 'Cambio' };
const ICON = { goal: '⚽', penalty: '⚽', 'own-goal': '⚽', 'penalty-missed': '✕', yellow: '', red: '', sub: '⇄' };
const madrid = (iso, opts) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', ...opts });

/** The tabs; `tab` is the open one ('general', 'stats', 'lineups' or 'h2h') and `choose` changes it. */
export function renderMatchCenter(el, m, tab, choose) {
  const crest = (t, cls = 'mc-crest') => t.logo ? el('img', { class: cls, src: t.logo, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' })
    : el('span', { class: `${cls} mc-crest-empty`, 'aria-hidden': 'true' }, (t.short || t.name || '?').slice(0, 3));
  const scored = m.home.score !== '' && m.away.score !== '';
  const kickoff = m.date && Number.isFinite(Date.parse(m.date)) ? madrid(m.date, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const board = el('div', { class: 'mc-board' },
    el('div', { class: 'mc-team home' }, crest(m.home), el('b', {}, m.home.name)),
    el('div', { class: 'mc-score' },
      scored ? el('strong', { 'aria-label': `${m.home.score} a ${m.away.score}` }, `${m.home.score} – ${m.away.score}`) : el('strong', { class: 'mc-vs' }, kickoff ? madrid(m.date, { hour: '2-digit', minute: '2-digit' }) : 'vs'),
      el('span', { class: `mc-status${m.live ? ' live' : ''}` }, (m.status || '').replace(/^\d+ – \d+ · /, '') || kickoff)),
    el('div', { class: 'mc-team away' }, crest(m.away), el('b', {}, m.away.name)));
  const tabs = [['general', 'General'], ['stats', 'Estadísticas'], ['lineups', 'Alineaciones'], ['h2h', 'H2H']];
  const bar = el('div', { class: 'mc-tabs', role: 'tablist', 'aria-label': 'Datos del partido' }, tabs.map(([id, label]) =>
    el('button', { class: 'mc-tab', type: 'button', role: 'tab', id: `mc-tab-${id}`, 'aria-selected': String(tab === id), 'aria-controls': 'mc-panel', tabindex: tab === id ? '0' : '-1',
      onclick: () => choose(id), onkeydown: (e) => {
        const i = tabs.findIndex(([t]) => t === id), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (step) { e.preventDefault(); choose(tabs[(i + step + tabs.length) % tabs.length][0], true); }
      } }, label)));
  const empty = (text) => el('p', { class: 'mc-empty' }, text);
  const note = m.note ?? (m.source === 'event' ? 'Este evento no tiene enlace del partido. Al añadirlo en el administrador aparecerán aquí el marcador, las estadísticas y las alineaciones.' : '');
  const noLink = note ? el('p', { class: 'mc-note' }, note) : null;
  const names = el('div', { class: 'mc-names' }, el('span', { class: 'home' }, m.home.name), el('span', { class: 'away' }, m.away.name));
  const stat = (key) => m.stats.find((s) => s.key === key);
  let body;
  if (tab === 'stats') {
    body = m.stats.length ? el('div', { class: 'mc-stats' }, names,
      m.stats.map((s) => el('div', { class: 'mc-stat' },
        el('div', { class: 'mc-stat-row' }, el('b', { class: s.share > 0.5 ? 'lead' : '' }, s.home), el('span', {}, s.label), el('b', { class: s.share < 0.5 ? 'lead' : '' }, s.away)),
        el('div', { class: 'mc-bars', 'aria-hidden': 'true' }, el('span', { class: 'home', style: `--w:${Math.round(s.share * 100)}%` }), el('span', { class: 'away', style: `--w:${Math.round((1 - s.share) * 100)}%` })))))
      : [noLink, empty(m.state === 'scheduled' ? 'Las estadísticas aparecen cuando empieza el partido.' : 'No hay estadísticas de este partido.')];
  } else if (tab === 'lineups') {
    const list = (players) => el('ol', { class: 'mc-players' }, players.map((p) => el('li', {},
      el('span', { class: 'mc-number' }, p.number), el('span', { class: 'mc-name' }, p.name, p.subbedOut ? el('span', { class: 'mc-out', title: 'Sustituido' }, ' ↓') : null, p.subbedIn ? el('span', { class: 'mc-in', title: 'Entró' }, ' ↑') : null),
      el('span', { class: 'mc-pos' }, p.position))));
    body = m.lineups.length ? el('div', { class: 'mc-lineups' }, m.lineups.map((l) => el('section', { class: `mc-lineup ${l.side}` },
      el('h3', {}, crest(l.team), el('span', {}, l.team.name), l.formation ? el('small', {}, l.formation) : null),
      list(l.starters), l.subs.length ? [el('h4', {}, 'Suplentes'), list(l.subs)] : null)))
      : [noLink, empty(m.state === 'scheduled' ? 'Las alineaciones se publican poco antes del partido.' : 'No hay alineaciones de este partido.')];
  } else if (tab === 'h2h') {
    body = m.h2h.length ? el('ol', { class: 'mc-h2h' }, m.h2h.map((g) => el('li', {},
      el('span', { class: 'mc-h2h-date' }, g.date ? madrid(g.date, { day: 'numeric', month: 'short', year: 'numeric' }) : '', g.competition ? el('small', {}, g.competition) : null),
      el('span', { class: 'mc-h2h-game' }, el('span', {}, g.home), el('b', {}, g.score || 'vs'), el('span', {}, g.away)))))
      : [noLink, empty('No hay enfrentamientos anteriores registrados.')];
  } else {
    // General: timeline, key figures, incidents, form and details.
    const parts = [noLink];
    const maxMinute = Math.max(90, ...m.events.map((e) => minuteOf(e.minute)), m.live ? minuteOf(m.clock) : 0);
    if (m.events.length || m.live || m.state === 'finished' || m.state === 'halftime') {
      const at = (minute) => `${Math.min(100, (minute / maxMinute) * 100).toFixed(2)}%`;
      const marks = (side) => el('div', { class: `mc-line-row ${side}` }, m.events.filter((e) => e.side === side && e.kind !== 'sub').map((e) =>
        el('span', { class: `mc-mark ${e.kind}`, style: `left:${at(minuteOf(e.minute))}`, title: `${e.minute} ${KIND[e.kind]} · ${e.player}` }, ICON[e.kind])));
      parts.push(el('div', { class: 'mc-timeline', 'aria-label': 'Desarrollo del partido' },
        names,
        el('div', { class: 'mc-axis', 'aria-hidden': 'true' }, [0, 15, 30, 45, 60, 75, 90].map((n) => el('span', { style: `left:${at(n)}` }, `${n}'`))),
        marks('home'),
        el('div', { class: 'mc-track', 'aria-hidden': 'true' },
          el('span', { class: 'mc-progress', style: `width:${m.state === 'finished' ? '100%' : at(m.live ? minuteOf(m.clock) : m.state === 'halftime' ? 45 : 0)}` }),
          [15, 30, 45, 60, 75].map((n) => el('i', { style: `left:${at(n)}` }))),
        marks('away')));
    }
    const pct = (s) => s ? Math.round(s.share * 100) : 50;
    const gauge = (label, s) => el('div', { class: 'mc-gauge' }, el('span', { class: 'mc-gauge-label' }, label),
      el('div', { class: 'mc-gauge-row' }, el('b', { class: 'home' }, s.home), el('span', { class: 'mc-donut', style: `--p:${pct(s)}%`, 'aria-hidden': 'true' }), el('b', { class: 'away' }, s.away)));
    const gauges = [['Posesión', stat('possessionPct')], ['Tiros', stat('totalShots')], ['Tiros a puerta', stat('shotsOnTarget')]].filter(([, s]) => s);
    if (gauges.length) parts.push(el('div', { class: 'mc-gauges' }, gauges.map(([label, s]) => gauge(label, s))));
    if (m.stats.length) {
      const v = (key, side) => { const s = stat(key); return s ? s[side].replace('%', '') : '0'; };
      const card = (kind) => el('span', { class: `mc-card ${kind}`, 'aria-hidden': 'true' });
      const corner = () => el('span', { class: 'mc-flag', 'aria-hidden': 'true' }, '⚑');
      const cell = (icon, value, label) => el('span', { class: 'mc-cell', title: label }, icon, el('b', {}, value), el('span', { class: 'sr' }, label));
      const shots = (side) => el('span', { class: `mc-shots ${side}`, title: 'Tiros a puerta / tiros' }, el('b', {}, v('shotsOnTarget', side)), el('small', {}, v('totalShots', side)));
      parts.push(el('div', { class: 'mc-icons' },
        cell(corner(), v('wonCorners', 'home'), 'Córners del local'), cell(card('red'), v('redCards', 'home'), 'Tarjetas rojas del local'), cell(card('yellow'), v('yellowCards', 'home'), 'Tarjetas amarillas del local'),
        shots('home'), shots('away'),
        cell(card('yellow'), v('yellowCards', 'away'), 'Tarjetas amarillas del visitante'), cell(card('red'), v('redCards', 'away'), 'Tarjetas rojas del visitante'), cell(corner(), v('wonCorners', 'away'), 'Córners del visitante')),
        el('p', { class: 'mc-icons-label' }, 'Tiros a puerta / tiros totales'));
    }
    if (m.events.length) parts.push(el('ol', { class: 'mc-events', 'aria-label': 'Incidencias' }, m.events.map((e) => el('li', { class: `mc-event ${e.side} ${e.kind}` },
      el('span', { class: 'mc-minute' }, e.minute),
      el('span', { class: `mc-icon ${e.kind}`, 'aria-label': KIND[e.kind] }, ICON[e.kind]),
      el('span', { class: 'mc-what' }, el('b', {}, e.player || KIND[e.kind]), el('small', {}, e.kind === 'sub' && e.other ? `Sale ${e.other}` : KIND[e.kind]))))));
    else if (m.source === 'espn') parts.push(empty(m.state === 'scheduled' ? 'El partido aún no ha empezado.' : 'Sin incidencias por ahora.'));
    if (m.form.home.length || m.form.away.length) {
      const chips = (list) => el('span', { class: 'mc-form' }, list.map((f) => el('span', { class: `mc-result ${({ W: 'win', G: 'win', D: 'draw', E: 'draw', L: 'loss', P: 'loss' })[f.result] || ''}`, title: `${f.score} ${f.opponent}` },
        ({ W: 'V', G: 'V', D: 'E', E: 'E', L: 'D', P: 'D' })[f.result] || f.result)));
      parts.push(el('div', { class: 'mc-forms' }, el('h3', {}, 'Últimos partidos'),
        el('div', { class: 'mc-form-row' }, el('span', {}, m.home.name), chips(m.form.home)),
        el('div', { class: 'mc-form-row' }, el('span', {}, m.away.name), chips(m.form.away))));
    }
    const facts = [['Competición', [m.league, m.round].filter(Boolean).join(' · ')], ['Fecha', m.date ? madrid(m.date, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''],
      ['Estadio', m.venue], ['Ciudad', m.city], ['Asistencia', m.attendance ? m.attendance.toLocaleString('es-ES') : ''], ['Árbitro', m.referee]].filter(([, value]) => value);
    if (facts.length) parts.push(el('dl', { class: 'mc-facts' }, facts.flatMap(([k, value]) => [el('dt', {}, k), el('dd', {}, value)])));
    if (m.description) parts.push(el('p', { class: 'mc-description' }, m.description));
    body = parts;
  }
  return [board, bar, el('div', { class: 'mc-panel', id: 'mc-panel', role: 'tabpanel', 'aria-labelledby': `mc-tab-${tab}` }, body)];
}
