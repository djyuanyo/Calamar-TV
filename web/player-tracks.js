// Audio and subtitle tracks of films, series and documentaries: Spanish audio by default, subtitles off.

const SPANISH = /^(?:es|spa|esp)(?:[-_]|$)|castellano|espa[nñ]ol|spanish/i;
const LATIN = /latino|latam|es[-_](?:419|mx|ar|co|us)\b|lat\b/i;

/** The track to play by default: Spanish from Spain first, then any Spanish; -1 when there is none. */
export function spanishTrack(tracks) {
  const list = [...(tracks || [])].map((t, index) => ({ index, text: `${t?.lang || t?.language || ''} ${t?.name || t?.label || ''}`.trim() }));
  const spanish = list.filter((t) => SPANISH.test(t.text) || SPANISH.test(t.text.split(' ')[0]));
  return (spanish.find((t) => !LATIN.test(t.text)) || spanish[0] || { index: -1 }).index;
}

const LANGUAGES = { es: 'Español', spa: 'Español', esp: 'Español', en: 'Inglés', eng: 'Inglés', fr: 'Francés', fre: 'Francés', fra: 'Francés',
  it: 'Italiano', ita: 'Italiano', de: 'Alemán', ger: 'Alemán', deu: 'Alemán', pt: 'Portugués', por: 'Portugués', ja: 'Japonés', jpn: 'Japonés',
  ca: 'Catalán', cat: 'Catalán', eu: 'Euskera', eus: 'Euskera', baq: 'Euskera', gl: 'Gallego', glg: 'Gallego' };

/** A track as people read it: its own name, or its language in Spanish, or «Pista N». */
export function trackLabel(track, index) {
  const name = String(track?.name || track?.label || '').trim();
  const lang = String(track?.lang || track?.language || '').toLowerCase().split(/[-_]/)[0];
  if (name && !/^(?:audio|subtitles?|track|pista)?\s*\d*$/i.test(name)) return name;
  return LANGUAGES[lang] || `Pista ${index + 1}`;
}
