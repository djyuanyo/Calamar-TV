/** Prefer the feed's explicit sport. Legacy events fall back to their known competition. */
export const sportKey = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '')
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function eventSport(event, custom, definitions) {
  const league = (custom?.leagues || []).find(league => league.id === event.leagueId);
  const explicit = event.sport || league?.sport;
  if (explicit) {
    const value = sportKey(explicit);
    return definitions.sports.find(sport => [sport.id, sport.name, ...(sport.aliases || [])]
      .some(alias => sportKey(alias) === value))?.id || 'other';
  }
  if (league?.espn || event.matchUrl) return 'soccer';
  return definitions.leagues?.[sportKey(league?.name)] || 'other';
}
export function eventSportTabs(events, custom, definitions) {
  const counts = new Map();
  for (const event of events) {
    const id = eventSport(event, custom, definitions);
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [
    { id: 'all', name: 'Todos', icon: '', count: events.length },
    ...definitions.sports.filter(sport => counts.has(sport.id)).map(sport => ({ ...sport, count: counts.get(sport.id) })),
  ];
}
