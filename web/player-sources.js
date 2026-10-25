import { webPlayback, streamExpiry } from './catalog.js';

/** Keep catalog numbering, including unavailable alternatives, so a source never silently vanishes. */
export function sourceOptions(streams, now = Date.now()) {
  return streams.map((url, index) => {
    const how = webPlayback(url, { pages: true });
    const expiry = streamExpiry(url);
    const expired = !!expiry && expiry <= now;
    return {
      url, index, how, expiry,
      available: how.ok && !expired,
      label: `Fuente ${index + 1}`,
      reason: expired ? 'Caducada' : how.ok ? '' : how.reason,
    };
  });
}

export function selectedSource(sources, index) {
  return sources.find((source) => source.index === index && source.available)
    || sources.find((source) => source.available)
    || null;
}

export function renderSourcePicker(container, sources, selectedIndex, onChange) {
  container.hidden = sources.length < 2;
  container.replaceChildren();
  if (container.hidden) return;
  const doc = container.ownerDocument;
  const label = doc.createElement('label');
  label.className = 'source-picker';
  const title = doc.createElement('span');
  title.textContent = 'Fuentes';
  const select = doc.createElement('select');
  select.id = 'player-source-select';
  select.setAttribute('aria-label', 'Cambiar fuente');
  select.disabled = !sources.some((source) => source.available);
  if (!sources.length) {
    const option = doc.createElement('option');
    option.textContent = 'Sin fuentes';
    select.append(option);
  } else if (!sources.some((source) => source.index === selectedIndex)) {
    const option = doc.createElement('option');
    option.textContent = 'Elige una fuente';
    option.value = '';
    option.disabled = true;
    option.selected = true;
    select.append(option);
  }
  for (const source of sources) {
    const option = doc.createElement('option');
    option.value = String(source.index);
    option.textContent = source.label + (source.reason ? ` · ${source.reason}` : '');
    option.disabled = !source.available;
    option.selected = source.index === selectedIndex;
    select.append(option);
  }
  select.addEventListener('change', () => {
    const source = sources.find((item) => item.index === Number(select.value));
    if (source?.available) onChange(source.index);
  });
  label.append(title, select);
  container.replaceChildren(label);
}
