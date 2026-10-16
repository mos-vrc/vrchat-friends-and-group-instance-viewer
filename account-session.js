// Check the live browser session at operation boundaries; never infer it from UI state.
export function assertAccount(user, expected) {
  if (!expected || user?.id !== expected) {
    const error = new Error('VRChat account changed');
    error.code = 'ACCOUNT_CHANGED';
    throw error;
  }
  return user;
}
export async function requireAccount(api, expected) {
  if (!expected) return null;
  if (typeof api.verifyAccount === 'function') return api.verifyAccount(expected);
  return assertAccount(await api.fetchJson('/auth/user'), expected);
}
