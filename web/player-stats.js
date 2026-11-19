/** Player statistics are requested only when their card opens, for this match and its season. */
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/';
export const PLAYER_STATS = [
  ['appearances', 'Partidos'], ['starts', 'Titularidades'], ['minutes', 'Minutos'],
  ['totalGoals', 'Goles'], ['goalAssists', 'Asistencias'], ['totalShots', 'Tiros'],
  ['shotsOnTarget', 'Tiros a puerta'], ['shotAssists', 'Ocasiones creadas'],
  ['totalPasses', 'Pases'], ['accuratePasses', 'Pases completados'], ['passPct', 'Precisión de pase'],
  ['touches', 'Toques'], ['totalCrosses', 'Centros'], ['accurateCrosses', 'Centros completados'],
  ['totalLongBalls', 'Balones largos'], ['totalTackles', 'Entradas'], ['effectiveTackles', 'Entradas ganadas'],
  ['interceptions', 'Intercepciones'], ['recoveries', 'Recuperaciones'], ['totalClearance', 'Despejes'],
  ['blockedShots', 'Tiros bloqueados'], ['duelsWon', 'Duelos ganados'], ['duelsLost', 'Duelos perdidos'],
  ['foulsCommitted', 'Faltas cometidas'], ['foulsSuffered', 'Faltas recibidas'], ['offsides', 'Fueras de juego'],
  ['yellowCards', 'Tarjetas amarillas'], ['redCards', 'Tarjetas rojas'], ['ownGoals', 'Goles en propia puerta'],
  ['saves', 'Paradas', 'keeper'], ['goalsConceded', 'Goles encajados', 'keeper'],
  ['cleanSheet', 'Porterías a cero', 'keeper'], ['penaltyKicksSaved', 'Penaltis parados', 'keeper'],
  ['savePct', 'Porcentaje de paradas', 'keeper'],
];
const numeric = value => /^\d+$/.test(String(value || ''));
export function playerStatsUrls(match, player) {
  const league = /^[a-z0-9]+(?:\.[a-z0-9_]+)+$/.test(match.leagueCode || '') ? match.leagueCode : '';
  if (!league || !numeric(player.id)) return { match: '', season: '' };
  const base = CORE + league;
  const suffix = '?lang=es&region=es';
  return {
    match: numeric(match.id) && numeric(player.teamId)
      ? `${base}/events/${match.id}/competitions/${match.id}/competitors/${player.teamId}/roster/${player.id}/statistics/0${suffix}` : '',
    season: /^20\d{2}$/.test(String(match.seasonYear)) && numeric(match.seasonType)
      ? `${base}/seasons/${match.seasonYear}/types/${match.seasonType}/athletes/${player.id}/statistics/0${suffix}` : '',
  };
}
export function playerStatRows(data, position = '') {
  const stats = Array.isArray(data) ? data : (data?.splits?.categories || []).flatMap(category => category.stats || []);
  const byName = new Map(stats.map(stat => [stat.name, stat]));
  return PLAYER_STATS.flatMap(([key, label, keeper]) => {
    const stat = byName.get(key);
    if (!stat || (keeper && !/^(G|GK)$/i.test(position))) return [];
    const raw = stat.displayValue ?? stat.value;
    if (raw == null || raw === '' || raw === '-' || !Number.isFinite(Number.parseFloat(String(raw).replace(',', '.')))) return [];
    let value = String(raw);
    if (key.endsWith('Pct')) {
      const number = Number(stat.value ?? Number.parseFloat(value));
      value = `${(number >= 0 && number <= 1 ? number * 100 : number).toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
    }
    return [{ key, label, value }];
  });
}

const cache = new Map();
export async function fetchPlayerStats(url, fetcher = globalThis.fetch) {
  if (!url) return null;
  const saved = cache.get(url);
  if (saved && Date.now() - saved.at < 60000) return saved.promise;
  const promise = (async () => {
    const response = await fetcher(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(12000) });
    if (response.status === 404) return null;
    if (!response.ok) throw Error('No se pudieron cargar las estadísticas.');
    return response.json();
  })();
  cache.set(url, { at: Date.now(), promise });
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  try { return await promise; }
  catch (error) { if (cache.get(url)?.promise === promise) cache.delete(url); throw error; }
}

export function showPlayerStats(el, match, player) {
  document.querySelector('.mc-player-dialog')?.close();
  const trigger = document.activeElement;
  const dialog = el('dialog', { class: 'mc-player-dialog', 'aria-label': `Estadísticas de ${player.name}` });
  // Dialog navigation must not trigger the video's volume, seek or close shortcuts.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  const close = el('button', { class: 'ghost', type: 'button', onclick: () => dialog.close() }, 'Cerrar');
  const urls = playerStatsUrls(match, player);
  const table = rows => el('dl', { class: 'mc-player-stats' }, rows.flatMap(row => [
    el('dt', {}, row.label), el('dd', {}, row.value),
  ]));
  const section = (title, url, initial, pending = '') => {
    const body = el('div', {}, pending ? el('p', { class: 'note' }, pending)
      : initial.length ? table(initial) : el('p', { class: 'note' }, 'Cargando estadísticas…'));
    const card = el('section', { class: 'mc-player-section' }, el('h3', {}, title), body);
    const load = async () => {
      if (!url || pending) {
        if (!pending && !initial.length) body.replaceChildren(el('p', { class: 'note' }, 'Estadísticas no disponibles.'));
        return;
      }
      try {
        const data = await fetchPlayerStats(url);
        if (!dialog.isConnected) return;
        const rows = playerStatRows(data, player.position);
        body.replaceChildren(rows.length ? table(rows) : initial.length ? table(initial) : el('p', { class: 'note' }, 'Estadísticas no disponibles.'));
      } catch {
        if (!dialog.isConnected) return;
        body.replaceChildren(...(initial.length ? [table(initial)] : []),
          el('p', { class: 'note' }, 'No se pudieron cargar las estadísticas.'),
          el('button', { type: 'button', class: 'ghost', onclick: () => {
            body.replaceChildren(el('p', { class: 'note' }, 'Cargando estadísticas…'));
            load();
          } }, 'Reintentar'));
      }
    };
    return { card, load };
  };
  const matchStats = section('Este partido', urls.match, playerStatRows(player.stats || [], player.position),
    match.state === 'scheduled' ? 'Las estadísticas aparecerán cuando empiece el partido.' : '');
  const seasonStats = section('En la competición', urls.season, []);
  dialog.append(el('div', { class: 'mc-player-heading' },
    player.photo || player.shirt ? el('img', { src: player.photo || player.shirt, alt: '', referrerpolicy: 'no-referrer' }) : null,
    el('div', {}, el('h2', {}, player.name),
      el('p', { class: 'note' }, [player.number && `Dorsal ${player.number}`, player.teamName].filter(Boolean).join(' · '))), close),
    el('p', { class: 'note' }, [match.league, match.seasonName || match.seasonYear].filter(Boolean).join(' · ')),
    matchStats.card, seasonStats.card,
    el('p', { class: 'note mc-player-source' }, 'Datos de ESPN'));
  dialog.addEventListener('close', () => {
    dialog.remove();
    const target = trigger?.isConnected ? trigger : trigger?.id ? document.getElementById(trigger.id) : null;
    target?.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
  matchStats.load();
  seasonStats.load();
}
