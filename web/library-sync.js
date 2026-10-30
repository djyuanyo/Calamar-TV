import { lulustreamEmbed } from './catalog.js';

// Stable identities: Drive changes the encrypted playback token on every scan.
export function videoKey(address) {
  const lulu = lulustreamEmbed(String(address || ''))?.split('/').pop();
  if (lulu) return lulu;
  try {
    const u = new URL(address);
    const drive = u.hostname === 'www.googleapis.com' ? u.pathname.match(/^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/)?.[1]
      : u.hostname === 'calamarmenciano.com' && u.pathname === '/calamar-drive.php' ? u.searchParams.get('id')
      : u.hostname === 'drive.google.com' ? u.pathname.match(/^\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] : null;
    return drive ? `drive_${drive}` : u.href;
  } catch { return ''; }
}

const providerOf = key => key.startsWith('drive_') ? 'drive' : /^[A-Za-z0-9]{8,20}$/.test(key) ? 'lulu' : '';
const inventories = scan => scan.complete === true && Array.isArray(scan.inventory) ? scan.inventory : [];
const coverageCache = new WeakMap();
function coverage(scan) {
  if (!coverageCache.has(scan)) coverageCache.set(scan, {
    codes: new Set(inventories(scan).flatMap(source => source.links.map(videoKey))),
    sections: new Set(inventories(scan).map(source => `${source.provider}:${source.section}`)),
  });
  return coverageCache.get(scan);
}

/** Adopt old links when seen, or when the catalog already records a folder import. */
export function managedByScan(record, section, scan) {
  const code = videoKey(record.url);
  const { codes, sections } = coverage(scan);
  return codes.has(code) || (!!(record.fromFolder || record.file || record.files?.length) && sections.has(`${providerOf(code)}:${section}`));
}

/** Remove missing copies only after a complete scan, keeping copies in folders not being read. */
export function reconcileScan(sections, scan) {
  const inventory = inventories(scan), removed = { films: 0, shows: 0, episodes: 0 };
  if (!inventory.length) return { sections, removed };
  const scopes = new Set(inventory.map(source => source.id)), seen = new Map();
  for (const source of inventory) for (const link of source.links) {
    const code = videoKey(link), entry = seen.get(code) || { link, scopes: new Set() };
    entry.scopes.add(source.id); seen.set(code, entry);
  }
  const syncVideo = (record, section) => {
    const provenance = record.folderSources || {}, nextSources = {}, alive = new Map();
    for (const link of [record.url, ...(record.mirrors || [])].filter(Boolean)) {
      const code = videoKey(link), found = seen.get(code), previous = provenance[code] || [];
      const outside = previous.filter(scope => !scopes.has(scope));
      // An older catalog has only the section/site. New scans save the exact root folder per copy.
      const gone = !found && (previous.length ? !outside.length : managedByScan({ ...record, url: link }, section, scan));
      if (gone) continue;
      alive.set(code, found?.link || link);
      const origins = [...new Set([...outside, ...(found?.scopes || [])])];
      if (origins.length) nextSources[code] = origins;
    }
    if (!alive.size) return null;
    const links = [...alive.values()], next = { ...record, url: links[0] };
    if (links.length > 1) next.mirrors = links.slice(1); else delete next.mirrors;
    if (Object.keys(nextSources).length) { next.folderSources = nextSources; next.fromFolder = true; }
    else delete next.folderSources;
    return next;
  };
  const next = Object.fromEntries(Object.entries(sections).map(([section, items]) => [section, items.flatMap(item => {
    if (item.kind !== 'tv') {
      const film = syncVideo(item, section);
      if (!film) removed.films++;
      return film ? [film] : [];
    }
    const episodes = (item.episodes || []).flatMap(episode => {
      const video = syncVideo(episode, section);
      if (!video) removed.episodes++;
      return video ? [video] : [];
    });
    if (!episodes.length) { removed.shows++; return []; }
    return [{ ...item, episodes }];
  })]));
  return { sections: next, removed };
}
