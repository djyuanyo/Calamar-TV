/** Playback slots shared by every device and profile of one account. Firestore arbitrates each claim. */
export const DEFAULT_SCREENS = 1, MAX_SCREENS = 10, LEASE_MS = 90000, HEARTBEAT_MS = 30000;
export const liveSlot = (slot, now = Date.now()) => !!slot && Number.isFinite(slot.at) && slot.at + LEASE_MS > now;
export function limitMessage(limit, live = []) {
  if (live.length < limit) return null;
  const titles = [...new Set(live.map(s => s.title).filter(Boolean))].slice(0, 3).join(', ');
  return `Se ha superado el límite de reproducciones simultáneas de tu cuenta (${limit} ${limit === 1 ? 'pantalla' : 'pantallas'}).`
    + (titles ? ` Ahora se está viendo: ${titles}.` : '') + ' Cierra la otra reproducción y vuelve a intentarlo.';
}
export function claimPlan(slots, holder, count, limit = DEFAULT_SCREENS, now = Date.now()) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SCREENS) throw Error('Número de reproducciones no válido.');
  limit = Number.isInteger(limit) ? Math.max(1, Math.min(MAX_SCREENS, limit)) : DEFAULT_SCREENS;
  const live = slots.filter(s => s && s.holder !== holder && liveSlot(s, now));
  const free = Array.from({length: limit}, (_, i) => i).filter(i => !slots[i] || slots[i].holder === holder || !liveSlot(slots[i], now));
  if (free.length < count) {
    const error = Error(limitMessage(limit, live) || `Se ha superado el límite de reproducciones simultáneas de tu cuenta (${limit} ${limit === 1 ? 'pantalla' : 'pantallas'}).`);
    error.code = 'screens-limit'; throw error;
  }
  return free.slice(0, count);
}
