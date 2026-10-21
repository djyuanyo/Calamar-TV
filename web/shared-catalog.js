import { validateSports } from './sports.js';
export const ADMIN_EMAIL = 'juanjocarrillo7@gmail.com';
export const CATALOG_PATH = 'calamarCatalog/custom';

export function validateCatalog(data) {
  if (!data || !['channels', 'featured', 'hidden'].every((key) => Array.isArray(data[key]))) throw new Error('El catálogo no tiene un formato válido.');
  const ids = new Set();
  for (const c of data.channels) {
    if (!c || typeof c.id !== 'string' || !c.id || ids.has(c.id) || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.streams) || !c.streams.length) throw new Error('Hay un canal incompleto o duplicado.');
    ids.add(c.id);
    for (const s of c.streams) {
      if (typeof s !== 'string' || !/^https?:$/.test(new URL(s).protocol)) throw new Error('Los enlaces deben empezar por http o https.');
    }
  }
  if (data.events !== undefined && !Array.isArray(data.events)) throw new Error('La lista de eventos no es válida.');
  const eventIds = new Set();
  for (const event of data.events || []) {
    if (!event || typeof event.id !== 'string' || !event.id || eventIds.has(event.id)
        || typeof event.name !== 'string' || !event.name.trim() || !ids.has(event.channelId)
        || typeof event.cover !== 'string' || !validCover(event.cover)) throw new Error('Cada evento necesita nombre, portada y un canal creado.');
    eventIds.add(event.id);
  }
  validateSports(data, validCover);
  if (![...data.featured, ...data.hidden].every((id) => typeof id === 'string')) throw new Error('La lista de canales no es válida.');
  if (new TextEncoder().encode(JSON.stringify(data)).length > 500000) throw new Error('El catálogo supera el tamaño permitido.');
  return data;
}

export function validCover(value) {
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value.length <= 180000;
  try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
}
