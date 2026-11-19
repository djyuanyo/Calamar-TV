import { accessDecision, DEFAULT_WEB_ACCESS, registeredAccount } from './access-policy.js';
import { expiredAt } from './screen-limit.js';

/** Uses Firebase's confirmed session, never the account/profile copy kept in localStorage. */
export function createWebAccess(shared, changed, { timeout = 12000 } = {}) {
  let identityKey, state, stopPolicy, stopAuth, stopBlocked, stopLimits, expiryTimer, timer, generation = 0, memberGeneration = 0;
  const notify = () => changed({ ...state, decision: accessDecision(state) });
  const current = () => ({ ...state, error: state.policyError || state.authError || state.blockError || state.error, decision: accessDecision(state) });
  const start = () => {
    const mine = ++generation; ++memberGeneration;
    stopPolicy?.(); stopAuth?.(); stopBlocked?.(); stopLimits?.(); clearTimeout(timer); clearTimeout(expiryTimer);
    identityKey = undefined;
    state = { policy: DEFAULT_WEB_ACCESS, policyReady: false, authReady: false, user: null, administrator: false, blockReady: false, blocked: false, error: null };
    timer = setTimeout(() => { if (mine !== generation || accessDecision(state) !== 'loading') return; state[!state.policyReady ? 'policyError' : !state.authReady ? 'authError' : 'blockError'] = Error('No se pudo comprobar el acceso. Comprueba la conexión y vuelve a intentarlo.'); notify(); }, timeout);
    shared().then(async f => {
      await f.ready; if (mine !== generation) return;
      const account = user => {
        if (mine !== generation) return;
        const key = `${user?.uid || ''}|${user?.email || ''}|${user?.isAnonymous === true}|${f.administrator(user)}`;
        if (identityKey === key && state.authReady) return; identityKey = key;
        const tick = ++memberGeneration; stopBlocked?.(); stopBlocked = null; stopLimits?.(); stopLimits = null; clearTimeout(expiryTimer);
        state.limits = null; state.expired = false;
        state.user = user; state.authReady = true; state.administrator = f.administrator(user); state.blocked = false; state.blockError = null; state.blockReady = !registeredAccount(user) || state.administrator; state.authError = null;
        if (registeredAccount(user)) {
          Promise.resolve(f.recordMember?.()).catch(() => {});
          if (!state.administrator) stopBlocked = f.watchUserAccess(user.uid, blocked => {
            if (mine !== generation || tick !== memberGeneration) return; state.blocked = blocked; state.blockReady = true; state.blockError = null; notify();
          }, error => { if (mine !== generation || tick !== memberGeneration) return; state.blockError = error; notify(); });
          // Expiry date set by the administrator: once it arrives, nothing plays (no date: no expiry).
          if (!state.administrator && f.watchUserLimits) stopLimits = f.watchUserLimits(user.uid, limits => {
            if (mine !== generation || tick !== memberGeneration) return;
            clearTimeout(expiryTimer);
            state.limits = limits; state.expired = expiredAt(limits);
            const left = limits.expires ? limits.expires.getTime() - Date.now() : 0;
            if (!state.expired && left > 0 && left < 2 ** 31 - 1) expiryTimer = setTimeout(() => {
              if (mine !== generation || tick !== memberGeneration) return; state.expired = true; notify();
            }, left + 1000);
            notify();
          }, () => {});
        }
        notify();
      };
      account(f.currentUser());
      stopAuth = f.watchAuth(account);
      stopPolicy = f.watchWebAccess(policy => { if (mine !== generation) return; state.policy = policy; state.policyReady = true; state.policyError = null; notify(); }, error => { if (mine !== generation) return; state.policyError = error; notify(); });
    }).catch(error => { if (mine !== generation) return; state.authError = error; notify(); });
    notify();
  };
  state = { policy: DEFAULT_WEB_ACCESS, policyReady: false, authReady: false };
  return { current, start, retry: start, stop: () => { generation++; memberGeneration++; clearTimeout(timer); clearTimeout(expiryTimer); stopPolicy?.(); stopAuth?.(); stopBlocked?.(); stopLimits?.(); } };
}
