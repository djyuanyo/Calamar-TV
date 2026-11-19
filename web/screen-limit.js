import { HEARTBEAT_MS } from './audience.js';

// Expiry date and simultaneous screens the administrator gives each account (calamarUserLimits).
export const DEFAULT_SCREENS = 1;
export const MAX_SCREENS = 10;
// A screen counts while its last heartbeat is recent (two heartbeats and a margin).
export const FRESH_MS = 2 * HEARTBEAT_MS + 30000;
export const LIMIT_MESSAGE = 'Se ha superado el límite de reproducciones simultáneas.';

const asDate = value => {
  const date = value?.toDate?.() || (value instanceof Date ? value : null);
  return date && Number.isFinite(date.getTime()) ? date : null;
};

export function accountLimits(data) {
  const screens = Number.isInteger(data?.screens) && data.screens >= 1 ? Math.min(data.screens, MAX_SCREENS) : DEFAULT_SCREENS;
  return { expires: asDate(data?.expires), screens };
}

export const expiredAt = (limits, now = Date.now()) => !!limits?.expires && limits.expires.getTime() <= now;

/** The other screens of the account playing now (a screen is a browser tab or an app; old copies count each playback). */
export function otherScreens(entries, own, now = Date.now()) {
  const screens = new Set();
  for (const entry of entries) {
    const at = asDate(entry.updatedAt);
    const screen = entry.screen || entry.id;
    if (!at || now - at.getTime() > FRESH_MS || !screen || screen === own) continue;
    screens.add(screen);
  }
  return screens.size;
}

export const overLimit = (entries, own, limits, now = Date.now()) => otherScreens(entries, own, now) >= accountLimits(limits).screens;

/** The «Acceso hasta» text of the users panel and Mi cuenta. */
export const describeExpiry = limits => limits?.expires
  ? limits.expires.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'long' })
  : 'Sin fecha de caducidad';
