// Tizen 7 uses Chromium 94. These browser APIs appeared in later Chromium releases.
if (!Array.prototype.at) Object.defineProperty(Array.prototype, 'at', {
  configurable: true, writable: true, value(index) {
    const offset = Math.trunc(index) || 0;
    const position = offset < 0 ? this.length + offset : offset;
    return position < 0 || position >= this.length ? undefined : this[position];
  },
});

if (!Object.hasOwn) Object.hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// Calamar TV uses structuredClone for JSON catalog and profile data.
if (!window.structuredClone) window.structuredClone = data => JSON.parse(JSON.stringify(data));

if (!AbortSignal.timeout) AbortSignal.timeout = delay => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado', 'TimeoutError')), delay);
  return controller.signal;
};

if (!AbortSignal.any) AbortSignal.any = signals => {
  const controller = new AbortController();
  const abort = event => {
    for (const signal of signals) signal.removeEventListener('abort', abort);
    controller.abort(event.target.reason);
  };
  const aborted = signals.find(signal => signal.aborted);
  if (aborted) controller.abort(aborted.reason);
  else for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
  return controller.signal;
};
