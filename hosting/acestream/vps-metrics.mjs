import { readFileSync, readdirSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';

const interval = 2000;
const windowMs = 5 * 60 * 1000;
const cacheDir = '/var/cache/calamar-ace-hls';

function cpuTicks() {
  return readFileSync('/proc/stat', 'utf8').split('\n', 1)[0].trim().split(/\s+/).slice(1, 9).map(Number);
}

export function cpuPercent(before, after) {
  const deltas = after.map((value, index) => Math.max(0, value - before[index]));
  const total = deltas.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const busy = deltas[0] + deltas[1] + deltas[2] + deltas[5] + deltas[6];
  return Math.round(busy * 1000 / total) / 10;
}

function openChannels() {
  try {
    return readdirSync(cacheDir, { withFileTypes: true }).filter(entry => entry.isDirectory() && /^[a-f0-9]{32}$/.test(entry.name)).length;
  } catch {
    return null;
  }
}

export function startVpsMetrics() {
  const history = [];
  let previous = cpuTicks();
  setInterval(() => {
    try {
      const next = cpuTicks();
      const cpu = cpuPercent(previous, next);
      previous = next;
      if (cpu === null) return;
      const at = Date.now();
      history.push({ at, cpu, channels: openChannels(), load: Math.round(loadavg()[0] * 100) / 100 });
      while (history[0]?.at < at - windowMs) history.shift();
    } catch (error) {
      console.error('Métricas VPS:', error.code || error.name);
    }
  }, interval).unref();
  return () => ({ cores: availableParallelism(), windowMs, history });
}
