/** The player only submits a report after the viewer confirms it. */
export function offerChannelReport(el, player, channel, submit) {
  const status = el('p', { role: 'status', class: 'note' });
  const cancel = el('button', { type: 'button', class: 'ghost', onclick: () => { if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); } }, 'Cerrar');
  const send = el('button', { type: 'button', class: 'btn', onclick: async () => {
    send.disabled = true;
    status.textContent = 'Enviando…';
    try {
      await submit(channel);
      status.textContent = 'Aviso enviado al administrador.';
      send.hidden = true;
    } catch (error) {
      status.textContent = error?.code === 'report-signin' ? 'Inicia sesión con tu cuenta verificada para enviar el aviso.'
        : 'No se pudo enviar el aviso. Vuelve a intentarlo.';
      send.disabled = false;
    }
  } }, 'Avisar al administrador');
  const dialog = el('dialog', { class: 'credits-dialog channel-report-dialog', 'aria-label': 'Avisar de un fallo de reproducción' },
    el('h2', {}, 'No se ha podido reproducir'),
    el('p', {}, `¿Quieres avisar al administrador del fallo en «${channel.name}»?`),
    status, el('div', { class: 'actions' }, cancel, send));
  player.append(dialog);
  const open = () => {
    if (!dialog.isConnected || dialog.hasAttribute('open')) return;
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute('open', '');
  };
  const button = el('button', { type: 'button', class: 'ghost', onclick: open }, 'Avisar al administrador');
  return { button, open, close: () => dialog.remove() };
}
