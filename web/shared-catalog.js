import { validateSports } from './sports.js';
import { validateFixtures } from './competitions.js';
export const ADMIN_EMAIL = 'juanjocarrillo7@gmail.com';
export const CATALOG_PATH = 'calamarCatalog/custom';

export function validateCatalog(data, { checkSize = true } = {}) {
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
  const set = (list) => new Set((list || []).map((x) => x.id));
  validateFixtures(data, { leagues: set(data.leagues), teams: set(data.teams), channels: ids, eventIds, imageValid: validCover });
  if (data.groupOrder !== undefined && (!Array.isArray(data.groupOrder) || data.groupOrder.length > 200
      || data.groupOrder.some((g) => typeof g !== 'string' || !g.trim() || g.length > 80)
      || new Set(data.groupOrder).size !== data.groupOrder.length)) throw new Error('El orden de categorías no es válido.');
  if (data.libraryVisible !== undefined && typeof data.libraryVisible !== 'boolean') throw new Error('El interruptor de películas y series no es válido.');
  if (data.categories !== undefined) {
    const ids = new Set(), names = new Set();
    if (!Array.isArray(data.categories) || data.categories.length > 200) throw new Error('Las categorías no son válidas.');
    for (const c of data.categories) {
      const text = (v) => typeof v === 'string' && v.trim() && v.length <= 80;
      if (!c || !text(c.id) || !text(c.name) || typeof c.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c.color)) throw new Error('Cada categoría necesita nombre y color.');
      if (ids.has(c.id) || names.has(c.name.trim().toLocaleLowerCase('es'))) throw new Error(`La categoría «${c.name}» está repetida.`);
      ids.add(c.id); names.add(c.name.trim().toLocaleLowerCase('es'));
    }
  }
  if (![...data.featured, ...data.hidden].every((id) => typeof id === 'string')) throw new Error('La lista de canales no es válida.');
  if (checkSize && new TextEncoder().encode(JSON.stringify(data)).length > 500000) throw new Error('El catálogo supera el tamaño permitido.');
  return data;
}

export function validCover(value) {
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)) return value.length <= 180000;
  try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password; } catch { return false; }
}
