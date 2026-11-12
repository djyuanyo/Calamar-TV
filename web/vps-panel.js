const endpoint = 'https://video.calamarmenciano.com/ace-metrics';
const refreshMs = 3000;
const timeFormat = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const number = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
const percent = value => Number.isFinite(value) ? number.format(value) + ' %' : '–';
const mbps = value => Number.isFinite(value) ? number.format(value) + ' Mb/s' : '–';

function chart(el, label, series, { max, tick, detail }) {
  const inspected = el('output', { class: 'vps-inspected' });
  const canvas = el('canvas', { role: 'img', 'aria-label': label });
  const element = el('div', { class: 'vps-plot' }, canvas, inspected);
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
    const left = 54, right = width - 16, top = 16, bottom = height - 29;
    const limit = max(data?.history || []);
    const y = value => bottom - (bottom - top) * value / limit;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#b1b8c5';
    ctx.strokeStyle = '#303744';
    ctx.textBaseline = 'middle';
    for (const fraction of [0, .25, .5, .75, 1]) {
      const value = limit * fraction;
      ctx.fillText(tick(value), 8, y(value));
      ctx.beginPath();
      ctx.moveTo(left, y(value));
      ctx.lineTo(right, y(value));
      ctx.stroke();
    }
    ctx.fillText('−5 min', left, bottom + 15);
    ctx.fillText('Ahora', right - ctx.measureText('Ahora').width, bottom + 15);

    const latest = data?.history.at(-1);
    if (!latest) return;
    const start = latest.at - data.windowMs;
    const history = data.history.filter(point => point.at >= start);
    const x = at => left + (right - left) * (at - start) / data.windowMs;
    const hovered = pointer != null && pointer >= x(history[0].at) && pointer <= right;
    const at = hovered ? start + data.windowMs * (pointer - left) / (right - left) : latest.at;
    const point = history.reduce((best, sample) => Math.abs(sample.at - at) < Math.abs(best.at - at) ? sample : best, latest);
    if (hovered) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff70';
      ctx.lineWidth = 1;
      ctx.moveTo(x(point.at), top);
      ctx.lineTo(x(point.at), bottom);
      ctx.stroke();
      inspected.textContent = `${timeFormat.format(point.at)} · ${detail(point)}`;
    } else inspected.textContent = '';

    for (const { value, color, fill } of series) {
      const points = history.filter(sample => Number.isFinite(value(sample)));
      if (!points.length) continue;
      const trace = () => {
        ctx.moveTo(x(points[0].at), y(value(points[0])));
        for (const sample of points.slice(1)) ctx.lineTo(x(sample.at), y(value(sample)));
      };
      if (fill) {
        ctx.beginPath();
        trace();
        ctx.lineTo(x(points.at(-1).at), bottom);
        ctx.lineTo(x(points[0].at), bottom);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, top, 0, bottom);
        gradient.addColorStop(0, fill);
        gradient.addColorStop(1, '#eaa7420b');
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      ctx.beginPath();
      trace();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (!Number.isFinite(value(point))) continue;
      ctx.beginPath();
      ctx.arc(x(point.at), y(value(point)), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  const resize = new ResizeObserver(draw);
  canvas.addEventListener('pointermove', event => { pointer = event.offsetX; draw(); });
  canvas.addEventListener('pointerleave', () => { pointer = undefined; draw(); });
  return { element, observe: () => resize.observe(canvas), disconnect: () => resize.disconnect(),
    update: update => { data = update; draw(); } };
}

function networkScale(history) {
  const peak = Math.max(1, ...history.flatMap(point => [point.net?.tx || 0, point.net?.rx || 0]));
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return magnitude * ([1, 2, 5, 10].find(step => step * magnitude >= peak) || 10);
}

export function vpsPanel(el, getToken) {
  const cpu = el('strong', {}, '–'), peak = el('strong', {}, '–'), memory = el('strong', {}, '–'), load = el('strong', {}, '–');
  const tx = el('strong', {}, '–'), rx = el('strong', {}, '–');
  const channels = el('p', { class: 'note' });
  const status = el('p', { class: 'note', role: 'status' }, 'Conectando con IONOS…');
  const cpuChart = chart(el, 'Uso de CPU del VPS durante cinco minutos', [
    { value: point => point.cpu, color: '#ffc363', fill: '#eaa74266' },
  ], { max: () => 100, tick: percent, detail: point => `CPU ${percent(point.cpu)}${point.channels == null ? '' : ` · Ace Stream ${point.channels}`}` });
  const networkChart = chart(el, 'Tráfico de red del VPS durante cinco minutos', [
    { value: point => point.net?.tx, color: '#ffc363' },
    { value: point => point.net?.rx, color: '#77d9f2' },
  ], { max: networkScale, tick: value => number.format(value), detail: point => `Enviado ${mbps(point.net?.tx)} · Recibido ${mbps(point.net?.rx)}` });
  const charts = [cpuChart, networkChart];
  const tile = (label, value) => el('div', {}, el('span', {}, label), value);
  const panel = el('section', { class: 'vps-panel', 'aria-label': 'Rendimiento del VPS' },
    el('div', { class: 'section-head' }, el('h2', {}, 'Rendimiento del VPS')),
    el('div', { class: 'vps-metrics' }, tile('CPU ahora', cpu), tile('Pico de CPU en 5 min', peak),
      tile('RAM usada', memory), tile('Carga en 1 min', load)),
    cpuChart.element,
    el('div', { class: 'vps-network-heading' }, el('h3', {}, 'Tráfico total del VPS'), el('div', { class: 'vps-network-legend' },
      el('span', { class: 'vps-network-tx' }, 'Enviado ', tx), el('span', { class: 'vps-network-rx' }, 'Recibido ', rx))),
    networkChart.element,
    channels, status);
  let data;
  const disconnect = () => charts.forEach(graph => graph.disconnect());

  async function refresh() {
    if (!panel.isConnected) { disconnect(); return; }
    if (!document.hidden) {
      try {
        const token = await getToken();
        const response = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(10000),
        });
        if (response.status === 401) {
          status.textContent = 'Vuelve a iniciar sesión con tu cuenta de administración para ver las métricas.';
          disconnect();
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
          memory.textContent = percent(current.memory);
          load.textContent = `${number.format(current.load)} / ${data.cores} vCPU`;
          tx.textContent = mbps(current.net?.tx);
          rx.textContent = mbps(current.net?.rx);
          channels.textContent = current.channels == null ? '' : `Señales Ace Stream abiertas · ${current.channels}`;
          status.textContent = `Última lectura · ${timeFormat.format(current.at)} (hora de Madrid)`;
          charts.forEach(graph => graph.update(data));
        } else status.textContent = 'Esperando la primera lectura del VPS…';
      } catch {
        status.textContent = data?.history?.length
          ? `Sin conexión con IONOS · Última lectura ${timeFormat.format(data.history.at(-1).at)}`
          : 'No se pueden leer las métricas de IONOS. Reintentando…';
      }
    }
    if (panel.isConnected) setTimeout(refresh, refreshMs);
    else disconnect();
  }

  requestAnimationFrame(() => {
    if (!panel.isConnected) return;
    charts.forEach(graph => graph.observe());
    void refresh();
  });
  return panel;
}
