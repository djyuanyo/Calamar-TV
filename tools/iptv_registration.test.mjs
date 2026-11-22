import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createIptvHls } from '../hosting/iptv-vps/hls.mjs';
import { createRegistry } from '../hosting/iptv-vps/register.mjs';
import { verifyViewer } from '../hosting/iptv-vps/access.mjs';
import { vpsIptvSource } from '../web/http-stream.js';
import { resolveIptvStreams } from '../web/iptv-vps.js';

const video = 'https://video.calamarmenciano.com/iptv-hls';
const key = 'a'.repeat(32);
const direct = 'https://example.com/live/index.m3u8';
const seedUrl = 'http://example.com:8080/provider-user/provider-pass/4';
const other = 'https://example.com/live/next.ts';
const token = 'signed.admin.token';
const web = 'https://djyuanyo.github.io';

test('the channel editor sends only IPTV transport streams to IONOS and saves the returned HTTPS link', async () => {
  const already = `${video}/${key}/index.m3u8`;
  const ace = `https://video.calamarmenciano.com/ace-live/${key}.ts`;
  const youtube = 'https://www.youtube.com/watch?v=12345678901';
  const zico = 'https://bp.zicotv.cc/api/player/4';
  const result = await resolveIptvStreams([direct, seedUrl, seedUrl, ace, youtube, zico, already], async () => token, async (address, init) => {
    assert.equal(address, `${video}/register`);
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), { url: seedUrl });
    return Response.json({ url: already });
  });
  assert.deepEqual(result, [direct, already, ace, youtube, zico]);
  assert.ok(vpsIptvSource('https://example.com/live/user/pass/123'));
  assert.ok(vpsIptvSource('https://example.com:8080/user/pass/123'));
  assert.deepEqual(await resolveIptvStreams([direct, already], () => assert.fail('No need for a token')), [direct, already]);
  await assert.rejects(resolveIptvStreams([other], async () => token, async () => Response.json({ url: direct })), /no pudo preparar/);
});

test('registration requires the admin account, reuses links from the playlist and survives a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calamar-iptv-register-'));
  const stateFile = join(root, 'registered.json');
  const viewer = 'signed.viewer.token';
  const config = { seed: { [key]: seedUrl }, stateFile, accepts: vpsIptvSource,
    authorize: async value => value === token, authorizeViewer: async value => value === viewer };
  let backend;
  try {
    const registry = await createRegistry(config);
    backend = await createIptvHls({ ...registry, root: join(root, 'cache') });
    backend.server.listen(0, '127.0.0.1');
    await once(backend.server, 'listening');
    const base = `http://127.0.0.1:${backend.server.address().port}/iptv-hls`;
    const endpoint = `${base}/register`;
    const request = (url, authorization = token, origin = web) => fetch(endpoint, {
      method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${authorization}` }, body: JSON.stringify({ url }),
    });
    const original = (authorization, key) => fetch(`${base}/original`, {
      method: 'POST', headers: { Authorization: `Bearer ${authorization}` }, body: JSON.stringify({ key }),
    });
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: web } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), web);
    assert.equal((await request(other, 'invalid.admin.token')).status, 401);
    assert.equal((await request(other, viewer)).status, 401);
    assert.equal((await request(other, token, 'https://example.org')).status, 403);
    assert.equal((await request('http://localhost/live.ts')).status, 400);
    assert.equal((await request(direct)).status, 400);
    assert.deepEqual(await (await request(seedUrl)).json(), { url: `${video}/${key}/index.m3u8` });
    assert.equal((await original('invalid.viewer.token', key)).status, 401);
    assert.equal((await original(viewer, 'b'.repeat(32))).status, 404);
    assert.deepEqual(await (await original(viewer, key)).json(), { url: seedUrl });
    const simultaneous = await Promise.all([request(other), request(other)]);
    const results = await Promise.all(simultaneous.map(async response => {
      assert.equal(response.status, 200);
      return response.json();
    }));
    assert.deepEqual(results[0], results[1]);
    const registered = results[0].url.split('/').at(-2);
    assert.match(registered, /^[a-f0-9]{32}$/);
    assert.equal(registry.channels[registered], other);
    assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), { [registered]: other });
    const recovered = await createRegistry(config);
    assert.deepEqual(recovered.channels, registry.channels);
  } finally {
    if (backend) await backend.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('viewer lookup requires a signed, verified and unblocked account', async () => {
  const claims = { sub: 'viewer123', aud: 'menciamedia', iss: 'https://securetoken.google.com/menciamedia',
    email_verified: true, exp: Date.now() / 1000 + 30, firebase: { sign_in_provider: 'password' } };
  const jwt = data => `header.${Buffer.from(JSON.stringify(data)).toString('base64url')}.signature`;
  const valid = jwt(claims);
  assert.equal(await verifyViewer(jwt({ ...claims, email_verified: false }), () => assert.fail()), false);
  assert.equal(await verifyViewer(valid, async () => new Response(null, { status: 403 })), false);
  assert.equal(await verifyViewer(valid, async () => Response.json({ name: 'access', fields: { blocked: { booleanValue: true } } })), false);
  assert.equal(await verifyViewer(valid, async (endpoint, init) => {
    assert.ok(endpoint.endsWith('/calamarUserAccess/viewer123'));
    assert.equal(init.headers.Authorization, `Bearer ${valid}`);
    return Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
  }), true);
});
