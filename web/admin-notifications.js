const devices = { web: 'Web', android: 'Android', tv: 'Android TV' };
const dates = new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' });

export function notificationsPanel(el, service) {
  let stop;
  const rows = el('div', { class: 'report-list' });
  const status = el('p', { class: 'note', role: 'status' }, 'Cargando notificaciones…');
  const more = el('button', { type: 'button', class: 'ghost', hidden: true }, 'Ver más');
  const panel = el('section', {}, el('h2', {}, 'Notificaciones'), status, rows, more);
  const read = async (report, button) => {
    button.disabled = true;
    try { await service.markChannelReportRead(report.id); }
    catch { status.textContent = 'No se pudo marcar el aviso como leído.'; button.disabled = false; }
  };
  let size = 30;
  const load = () => {
    stop?.();
    stop = service.watchChannelReports(size, reports => {
      rows.replaceChildren(...reports.map(report => {
        const when = report.createdAt?.toDate();
        return el('article', { class: 'report-row' },
          el('div', {}, el('strong', {}, report.title),
            el('p', { class: 'note' }, [report.target.startsWith('e:') ? 'Evento' : 'Canal', devices[report.device], when && dates.format(when)].filter(Boolean).join(' · '))),
          report.readAt ? null : el('button', { type: 'button', class: 'ghost', onclick: event => read(report, event.currentTarget) }, 'Marcar como leída'));
      }));
      status.textContent = reports.length ? '' : 'Todavía no hay avisos de reproducción.';
      more.hidden = reports.length < size;
    }, () => { status.textContent = 'No se pudieron cargar las notificaciones.'; });
  };
  more.addEventListener('click', () => { size += 30; load(); });
  load();
  return { panel, stop: () => stop?.() };
}
