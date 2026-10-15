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
  if (![...data.featured, ...data.hidden].every((id) => typeof id === 'string')) throw new Error('La lista de canales no es válida.');
  if (new TextEncoder().encode(JSON.stringify(data)).length > 500000) throw new Error('El catálogo supera el tamaño permitido.');
  return data;
}
