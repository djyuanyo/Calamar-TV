/** Explicit artwork survives refreshed TMDB metadata and folder imports. */
export function withArtwork(item, artwork) {
  const next = {};
  for (const key of ['poster', 'backdrop']) {
    const value = String(artwork[key] || '').trim();
    let valid = !value || /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) && value.length <= 180000;
    try { const url = new URL(value); valid ||= url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; } catch {}
    if (!valid) throw new Error('Usa una imagen JPEG, PNG o WebP, o un enlace HTTPS válido.');
    next[key] = value;
  }
  return { ...item, artwork: next, tmdb: { ...item.tmdb, ...next } };
}
export function keepArtwork(before, item) {
  const artwork = item.artwork || before?.artwork;
  return artwork ? withArtwork(item, artwork) : item;
}
