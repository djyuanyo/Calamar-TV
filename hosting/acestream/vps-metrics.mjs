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

export function networkCounters(text) {
  const counters = {};
  for (const line of text.split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    if (!name || name === 'lo') continue;
    const fields = line.slice(separator + 1).trim().split(/\s+/).map(Number);
    if (fields.length >= 9 && Number.isFinite(fields[0]) && Number.isFinite(fields[8])) {
      counters[name] = { rx: fields[0], tx: fields[8] };
    }
  }
  return counters;
}

export function networkRate(before, after, milliseconds) {
  const totals = { rx: 0, tx: 0 };
  if (!(milliseconds > 0)) return totals;
  for (const [name, next] of Object.entries(after)) {
    const previous = before[name];
    if (!previous) continue;
    for (const direction of ['rx', 'tx']) totals[direction] += Math.max(0, next[direction] - previous[direction]);
  }
  for (const direction of ['rx', 'tx']) {
    totals[direction] = Math.round(totals[direction] * 0.8 / milliseconds) / 100;
  }
  return totals;
}

function memoryPercent() {
  const info = readFileSync('/proc/meminfo', 'utf8');
  const total = Number(/^MemTotal:\s+(\d+)/m.exec(info)?.[1]);
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(info)?.[1]);
  return total > 0 && Number.isFinite(available) ? Math.round((total - available) * 1000 / total) / 10 : null;
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
  let netBefore = networkCounters(readFileSync('/proc/net/dev', 'utf8'));
  let previousSample = performance.now();
  setInterval(() => {
    try {
      const next = cpuTicks();
      const cpu = cpuPercent(previous, next);
      previous = next;
      const netAfter = networkCounters(readFileSync('/proc/net/dev', 'utf8'));
      const sampleTime = performance.now();
      const net = networkRate(netBefore, netAfter, sampleTime - previousSample);
      netBefore = netAfter;
      previousSample = sampleTime;
      if (cpu === null) return;
      const at = Date.now();
      history.push({ at, cpu, net, memory: memoryPercent(), channels: openChannels(), load: Math.round(loadavg()[0] * 100) / 100 });
      while (history[0]?.at < at - windowMs) history.shift();
    } catch (error) {
      console.error('Métricas VPS:', error.code || error.name);
    }
  }, interval).unref();
  return () => ({ cores: availableParallelism(), windowMs, history });
}
