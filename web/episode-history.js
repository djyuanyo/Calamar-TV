const empty = () => ({ recent: null, watched: {} });

export function mergeEpisodeHistory(a, b) {
  const watched = { ...a?.watched };
  for (const [id, at] of Object.entries(b?.watched || {})) {
    if (Number.isFinite(at) && at > (watched[id] || 0)) watched[id] = at;
  }
  const recent = (a?.recent?.at || 0) >= (b?.recent?.at || 0) ? a?.recent : b?.recent;
  return { recent: recent || null, watched };
}

export function recordEpisode(history, episode, completed, at = Date.now()) {
  return mergeEpisodeHistory(history, { recent: { episode, at }, watched: completed ? { [episode]: at } : {} });
}

function storageKey({ uid, profile, page, item }) {
  return 'calamar-episode-history:' + [uid || 'guest', profile || '', page, item].map(encodeURIComponent).join(':');
}

export function loadEpisodeHistory(context) {
  try { return mergeEpisodeHistory(null, JSON.parse(localStorage.getItem(storageKey(context)) || 'null')); }
  catch { return empty(); }
}

export function saveEpisodeHistory(context, history) {
  const merged = mergeEpisodeHistory(loadEpisodeHistory(context), history);
  try { localStorage.setItem(storageKey(context), JSON.stringify(merged)); } catch {}
  return merged;
}
