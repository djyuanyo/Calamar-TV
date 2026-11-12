const endpoint = 'https://video.calamarmenciano.com/ace-metrics';
const refreshMs = 3000;
const timeFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const percent = value => number.format(value) + ' %';

export function vpsPanel(el, getToken) {
  const cpu = el('strong', {}, '–');
  const peak = el('strong', {}, '–');
  const channels = el('strong', {}, '–');
  const load = el('strong', {}, '–');
  const status = el('p', { class: 'note', role: 'status' }, 'Conectando con IONOS…');
  const inspected = el('output', { class: 'vps-inspected' });
  const canvas = el('canvas', { role: 'img', 'aria-label': 'Historial de uso de CPU durante cinco minutos' });
  const tile = (label, value) => el('div', {}, el('span', {}, label), value);
  const panel = el('section', { class: 'vps-panel', 'aria-label': 'Rendimiento del VPS' },
    el('div', { class: 'section-head' }, el('h2', {}, 'Rendimiento del VPS')),
    el('div', { class: 'vps-metrics' }, tile('CPU ahora', cpu), tile('Pico en 5 min', peak),
      tile('Señales Ace Stream abiertas', channels), tile('Carga en 1 min', load)),
    el('div', { class: 'vps-plot' }, canvas, inspected),
    status);
  let data, pointer;

  function draw() {
    const width = Math.round(canvas.clientWidth), height = Math.round(canvas.clientHeight);
    if (!width || !height) return;
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(scale, scale);
    const left = 47, right = width - 16, top = 16, bottom = height - 29;
    const y = value => bottom - (bottom - top) * value / 100;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#b1b8c5';
    ctx.strokeStyle = '#303744';
    ctx.textBaseline = 'middle';
    for (const tick of [0, 25, 50, 75, 100]) {
      ctx.fillText(tick + ' %', 8, y(tick));
      ctx.beginPath();
      ctx.moveTo(left, y(tick));
      ctx.lineTo(right, y(tick));
      ctx.stroke();
    }
    ctx.fillText('−5 min', left, bottom + 15);
    ctx.fillText('Ahora', right - ctx.measureText('Ahora').width, bottom + 15);

    const latest = data?.history.at(-1);
    if (!latest) return;
    const start = latest.at - data.windowMs;
    const history = data.history.filter(point => point.at >= start);
    const x = at => left + (right - left) * (at - start) / data.windowMs;
    const trace = () => {
      ctx.moveTo(x(history[0].at), y(history[0].cpu));
      for (const point of history.slice(1)) ctx.lineTo(x(point.at), y(point.cpu));
    };
    ctx.beginPath();
    trace();
    ctx.lineTo(right, bottom);
    ctx.lineTo(x(history[0].at), bottom);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, '#eaa74266');
    fill.addColorStop(1, '#eaa7420b');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.beginPath();
    trace();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffc363';
    ctx.stroke();

    const at = pointer == null ? latest.at : start + data.windowMs * (pointer - left) / (right - left);
    const point = history.reduce((best, sample) => Math.abs(sample.at - at) < Math.abs(best.at - at) ? sample : best, latest);
    if (pointer != null && pointer >= x(history[0].at) && pointer <= right) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff70';
      ctx.lineWidth = 1;
      ctx.moveTo(x(point.at), top);
      ctx.lineTo(x(point.at), bottom);
      ctx.stroke();
      inspected.textContent = `${timeFormat.format(point.at)} · CPU ${percent(point.cpu)} · Señales ${point.channels ?? '–'}`;
    } else {
      inspected.textContent = '';
    }
    ctx.beginPath();
    ctx.arc(x(point.at), y(point.cpu), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc363';
    ctx.fill();
  }

  const resize = new ResizeObserver(draw);
  canvas.addEventListener('pointermove', event => { pointer = event.offsetX; draw(); });
  canvas.addEventListener('pointerleave', () => { pointer = undefined; draw(); });

  async function refresh() {
    if (!panel.isConnected) {
      resize.disconnect();
      return;
    }
    if (!document.hidden) {
      try {
        const token = await getToken();
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          status.textContent = 'Vuelve a iniciar sesión con tu cuenta de administración para ver la CPU.';
          return;
        }
        if (!response.ok) throw new Error('Métricas no disponibles');
        const update = await response.json();
        if (!Array.isArray(update.history) || !(update.windowMs > 0)) throw new Error('Historial no disponible');
        data = update;
        const current = data.history.at(-1);
        if (current) {
          cpu.textContent = percent(current.cpu);
          peak.textContent = percent(Math.max(...data.history.map(point => point.cpu)));
          channels.textContent = current.channels ?? '–';
          load.textContent = `${number.format(current.load)} / ${data.cores} vCPU`;
          status.textContent = `Última lectura · ${timeFormat.format(current.at)} (hora de Madrid)`;
          draw();
        } else {
          status.textContent = 'Esperando la primera lectura de CPU…';
        }
      } catch {
        status.textContent = data?.history?.length
          ? `Sin conexión con IONOS · Última lectura ${timeFormat.format(data.history.at(-1).at)}`
          : 'No se pueden leer las métricas de IONOS. Reintentando…';
      }
    }
    if (panel.isConnected) setTimeout(refresh, refreshMs);
    else resize.disconnect();
  }

  requestAnimationFrame(() => {
    if (!panel.isConnected) return;
    resize.observe(canvas);
    void refresh();
  });
  return panel;
}
