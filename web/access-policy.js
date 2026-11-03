// The same policy is used on the web, Android and Android TV. Missing settings require a real account.
export const DEFAULT_WEB_ACCESS = Object.freeze({ requireLogin: true });
export const webPolicy = value => ({ requireLogin: value?.requireLogin !== false });
export const registeredAccount = user => !!user && user.isAnonymous !== true && user.pending !== true;
export function accessDecision(s) {
  if (s.administrator && s.authReady) return 'allowed';
  if (s.error || s.policyError || s.authError || s.blockError) return 'error';
  if (!s.authReady || !s.policyReady) return 'loading';
  if (!registeredAccount(s.user)) return s.policy.requireLogin ? 'login' : 'allowed';
  if (!s.blockReady) return 'loading';
  if (s.blocked) return 'blocked';
  return 'allowed';
}
export function mergeUserDirectory(members, profiles, access) {
  const rows = new Map(profiles.map(p => {
    let account = {}; try { account = JSON.parse(p.json || '{}'); } catch {}
    const profiles = Array.isArray(account?.profiles) ? account.profiles : [];
    return [p.uid, { uid: p.uid, name: profiles[0]?.name || 'Usuario', profileCount: profiles.length }];
  }));
  for (const member of members) rows.set(member.uid, { ...rows.get(member.uid), ...member, name: member.name || rows.get(member.uid)?.name });
  for (const status of access) rows.set(status.uid, { ...rows.get(status.uid), uid: status.uid, blocked: status.blocked === true });
  return [...rows.values()].sort((a,b) => String(a.name || a.email || a.uid).localeCompare(String(b.name || b.email || b.uid), 'es'));
}
export const findUsers = (rows, text) => {
  const normalize = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es');
  const q = normalize(text.trim()); return rows.filter(u => normalize(`${u.name || ''} ${u.email || ''} ${u.uid}`).includes(q));
};
