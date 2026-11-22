import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { BlockList, isIPv4 } from 'node:net';

const restricted = new BlockList();
for (const [address, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
]) restricted.addSubnet(address, bits);

function addressFor(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash
      || !/^[a-z0-9.-]+$/i.test(url.hostname)) throw new Error('Origen IPTV no válido');
  return url;
}

export async function openUpstream(source, signal) {
  let url = addressFor(source);
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted();
    const addresses = await lookup(url.hostname, { family: 4, all: true });
    if (!addresses.length || addresses.some(({ address }) => !isIPv4(address) || restricted.check(address))) {
      throw new Error('El proveedor debe resolver a una dirección pública');
    }
    const address = addresses[0].address;
    const client = url.protocol === 'https:' ? https : http;
    const response = await new Promise((resolve, reject) => {
      const request = client.get(url, { signal, agent: false, family: 4, autoSelectFamily: false,
        lookup: (_name, _options, callback) => callback(null, address, 4) }, resolve);
      request.on('error', reject);
      request.setTimeout(15000, () => request.destroy(new Error('Tiempo de espera del proveedor')));
    });
    if (response.statusCode === 200) return response;
    response.destroy();
    if (![301, 302, 303, 307, 308].includes(response.statusCode) || !response.headers.location) {
      throw new Error(`El proveedor respondió HTTP ${response.statusCode}`);
    }
    url = addressFor(new URL(response.headers.location, url).href);
  }
  throw new Error('Demasiadas redirecciones del proveedor');
}
