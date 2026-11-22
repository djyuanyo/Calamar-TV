const project = 'menciamedia';

export async function verifyViewer(token, request = fetch) {
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { return false; }
  if (!claims || claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`
      || claims.email_verified !== true || claims.firebase?.sign_in_provider === 'anonymous'
      || typeof claims.sub !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(claims.sub)
      || !Number.isFinite(claims.exp) || claims.exp <= Date.now() / 1000) return false;

  // Firestore validates the signed Firebase token and restricts the read to the verified owner.
  const endpoint = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/calamarUserAccess/${claims.sub}`;
  const response = await request(endpoint, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(3500),
  });
  if (response.status === 401 || response.status === 403) return false;
  const data = await response.json();
  if (response.status === 404) return data.error?.status === 'NOT_FOUND';
  if (!response.ok || typeof data.name !== 'string') return false;
  return data.fields?.blocked?.booleanValue !== true && data.fields?.deleted?.booleanValue !== true;
}
