// The match under the video of an event with a Google match link: general information, statistics and
// line-ups from ESPN's summary of the match (the same source as the score on the cards).
import { matchResult } from './match-scores.js';

const logoOf = (team) => team?.logo || team?.logos?.[0]?.href || '';
const valid = (url) => /^https:\/\//.test(url || '') ? url : '';

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

/** Turns ESPN's summary into what the three tabs show; anything ESPN leaves out is simply not shown. */
export function parseMatchCenter(data) {
  const header = data.header || {}, competition = header.competitions?.[0] || {};
  const result = matchResult(data);
  const sideOf = (team) => {
    const c = (competition.competitors || []).find((x) => String(x.team?.id) === String(team?.id) || x.team?.displayName === team?.displayName);
    return c?.homeAway === 'away' ? 'away' : c?.homeAway === 'home' ? 'home' : '';
  };
  const team = (homeAway) => {
    const c = (competition.competitors || []).find((x) => x.homeAway === homeAway) || {};
    const score = typeof c.score === 'object' ? c.score?.displayValue : c.score;
    return { id: String(c.team?.id || ''), name: c.team?.displayName || c.team?.name || '', short: c.team?.abbreviation || '',
      logo: valid(logoOf(c.team)), score: /^\d+$/.test(String(score ?? '')) ? String(score) : '', form: c.form || '' };
  };
  const home = team('home'), away = team('away');
  const events = (data.keyEvents || []).map((e) => {
    const kind = eventKind(e);
    if (!kind) return null;
    const people = (e.participants || []).map((p) => p.athlete?.displayName).filter(Boolean);
    return { kind, minute: e.clock?.displayValue || '', side: sideOf(e.team), player: people[0] || '', other: people[1] || '',
      text: e.shortText || e.text || e.type?.text || '' };
  }).filter(Boolean);
  const byName = (teamEntry) => Object.fromEntries((teamEntry?.statistics || []).map((s) => [s.name, s]));
  const boxTeams = data.boxscore?.teams || [];
  const homeBox = byName(boxTeams.find((t) => sideOf(t.team) === 'home') || boxTeams[0]);
  const awayBox = byName(boxTeams.find((t) => sideOf(t.team) === 'away') || boxTeams[1]);
  const number = (v) => Number.parseFloat(String(v ?? '').replace(',', '.'));
  const stats = STATS.map(([key, label, unit = '']) => {
    const h = homeBox[key]?.displayValue, a = awayBox[key]?.displayValue;
    if (h == null && a == null) return null;
    const hv = number(h) || 0, av = number(a) || 0, total = hv + av;
    return { key, label, home: `${h ?? '0'}${unit && !String(h ?? '').includes('%') ? unit : ''}`, away: `${a ?? '0'}${unit && !String(a ?? '').includes('%') ? unit : ''}`,
      share: total > 0 ? hv / total : 0.5 };
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
  const info = data.gameInfo || {};
  const venue = info.venue || competition.venue || {};
  const referee = (info.officials || []).find((o) => /referee|árbitro/i.test(o.position?.displayName || o.position?.name || '')) || info.officials?.[0];
  return {
    id: result.id, state: result.state, status: result.text, clock: result.clock, live: result.live, home, away,
    league: header.league?.name || header.league?.abbreviation || '', round: competition.notes?.[0]?.headline || header.season?.name || '',
    date: competition.date || header.date || '', venue: venue.fullName || '', city: [venue.address?.city, venue.address?.country].filter(Boolean).join(', '),
    attendance: Number(info.attendance) > 0 ? Number(info.attendance) : 0, referee: referee?.displayName || referee?.fullName || '',
    events, stats, lineups,
  };
}

const ICONS = { goal: '⚽', penalty: '⚽', 'own-goal': '⚽', 'penalty-missed': '✕', yellow: '', red: '', sub: '⇄' };
const KIND = { goal: 'Gol', penalty: 'Gol de penalti', 'own-goal': 'Gol en propia puerta', 'penalty-missed': 'Penalti fallado', yellow: 'Tarjeta amarilla', red: 'Tarjeta roja', sub: 'Cambio' };

/** The three tabs; `tab` is the open one ('info', 'stats' or 'lineups') and `choose` changes it. */
export function renderMatchCenter(el, m, tab, choose) {
  const crest = (t) => t.logo ? el('img', { class: 'mc-crest', src: t.logo, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' }) : el('span', { class: 'mc-crest mc-crest-empty', 'aria-hidden': 'true' }, (t.short || t.name).slice(0, 3));
  const when = m.date ? new Date(m.date).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const board = el('div', { class: 'mc-board' },
    el('div', { class: 'mc-team' }, crest(m.home), el('b', {}, m.home.name)),
    el('div', { class: 'mc-score' },
      m.home.score !== '' && m.away.score !== '' ? el('strong', { 'aria-label': `${m.home.score} a ${m.away.score}` }, `${m.home.score} – ${m.away.score}`) : el('strong', { class: 'mc-vs' }, 'vs'),
      el('span', { class: `mc-status${m.live ? ' live' : ''}` }, m.status.replace(/^\d+ – \d+ · /, ''))),
    el('div', { class: 'mc-team' }, crest(m.away), el('b', {}, m.away.name)));
  const tabs = [['info', 'Información'], ['stats', 'Estadísticas'], ['lineups', 'Alineaciones']];
  const bar = el('div', { class: 'mc-tabs', role: 'tablist', 'aria-label': 'Datos del partido' }, tabs.map(([id, label]) =>
    el('button', { class: 'mc-tab', type: 'button', role: 'tab', id: `mc-tab-${id}`, 'aria-selected': String(tab === id), 'aria-controls': 'mc-panel', tabindex: tab === id ? '0' : '-1',
      onclick: () => choose(id), onkeydown: (e) => {
        const i = tabs.findIndex(([t]) => t === id), step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (step) { e.preventDefault(); choose(tabs[(i + step + tabs.length) % tabs.length][0], true); }
      } }, label)));
  const empty = (text) => el('p', { class: 'mc-empty' }, text);
  let body;
  if (tab === 'stats') {
    body = m.stats.length ? el('div', { class: 'mc-stats' },
      el('div', { class: 'mc-stats-head' }, el('span', {}, crest(m.home), m.home.short || m.home.name), el('span', {}, m.away.short || m.away.name, crest(m.away))),
      m.stats.map((s) => el('div', { class: 'mc-stat' },
        el('div', { class: 'mc-stat-row' }, el('b', { class: s.share > 0.5 ? 'lead' : '' }, s.home), el('span', {}, s.label), el('b', { class: s.share < 0.5 ? 'lead' : '' }, s.away)),
        el('div', { class: 'mc-bars', 'aria-hidden': 'true' }, el('span', { class: 'home', style: `--w:${Math.round(s.share * 100)}%` }), el('span', { class: 'away', style: `--w:${Math.round((1 - s.share) * 100)}%` })))))
      : empty(m.state === 'scheduled' ? 'Las estadísticas aparecerán cuando empiece el partido.' : 'ESPN no tiene estadísticas de este partido.');
  } else if (tab === 'lineups') {
    const list = (players) => el('ol', { class: 'mc-players' }, players.map((p) => el('li', {},
      el('span', { class: 'mc-number' }, p.number), el('span', { class: 'mc-name' }, p.name, p.subbedOut ? el('span', { class: 'mc-out', title: 'Sustituido' }, ' ↓') : null, p.subbedIn ? el('span', { class: 'mc-in', title: 'Entró' }, ' ↑') : null),
      el('span', { class: 'mc-pos' }, p.position))));
    body = m.lineups.length ? el('div', { class: 'mc-lineups' }, m.lineups.map((l) => el('section', { class: 'mc-lineup' },
      el('h3', {}, crest(l.team), el('span', {}, l.team.name), l.formation ? el('small', {}, l.formation) : null),
      list(l.starters), l.subs.length ? [el('h4', {}, 'Suplentes'), list(l.subs)] : null)))
      : empty(m.state === 'scheduled' ? 'Las alineaciones se publican poco antes del partido.' : 'ESPN no tiene las alineaciones de este partido.');
  } else {
    const facts = [['Competición', [m.league, m.round].filter(Boolean).join(' · ')], ['Fecha', when], ['Estadio', m.venue], ['Ciudad', m.city],
      ['Asistencia', m.attendance ? m.attendance.toLocaleString('es-ES') : ''], ['Árbitro', m.referee]].filter(([, v]) => v);
    body = el('div', { class: 'mc-info' },
      m.events.length ? el('ol', { class: 'mc-events', 'aria-label': 'Incidencias' }, m.events.map((e) => el('li', { class: `mc-event ${e.side} ${e.kind}` },
        el('span', { class: 'mc-minute' }, e.minute),
        el('span', { class: `mc-icon ${e.kind}`, 'aria-label': KIND[e.kind] }, ICONS[e.kind]),
        el('span', { class: 'mc-what' }, el('b', {}, e.player || KIND[e.kind]), e.kind === 'sub' && e.other ? el('small', {}, `Sale ${e.other}`) : el('small', {}, KIND[e.kind])))))
        : empty(m.state === 'scheduled' ? 'El partido aún no ha empezado.' : 'Sin incidencias por ahora.'),
      facts.length ? el('dl', { class: 'mc-facts' }, facts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])) : null);
  }
  return [board, bar, el('div', { class: 'mc-panel', id: 'mc-panel', role: 'tabpanel', 'aria-labelledby': `mc-tab-${tab}` }, body),
    el('p', { class: 'mc-credit' }, 'Datos: ESPN. Se actualizan cada 30 segundos.')];
}
