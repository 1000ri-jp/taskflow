export const TEST_SCOPE = 'events:test';
export const READ_SCOPE = 'events:read';
export const TASK_READ_SCOPE = 'tasks:read';
export const TASK_WRITE_SCOPE = 'tasks:write';
export const CONSENT_MS = 30 * 24 * 60 * 60 * 1000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const PILOT_PROJECT = 'SlBpu8BPYgIARk4DoYOV';

export function authorizationMode(scope, productionEnabled = false, taskAccessEnabled = false) {
  if (typeof scope !== 'string') return null;
  const scopes = scope.split(' ');
  if (new Set(scopes).size !== scopes.length) return null;
  if (scopes.includes(TEST_SCOPE) && scopes.every(s => [TEST_SCOPE, 'openid'].includes(s))) return 'test';
  if (productionEnabled && [READ_SCOPE, 'openid', 'offline_access'].every(s => scopes.includes(s)) &&
      scopes.every(s => [READ_SCOPE, 'openid', 'offline_access', ...(taskAccessEnabled ? [TASK_READ_SCOPE, TASK_WRITE_SCOPE] : [])].includes(s)) &&
      (!scopes.includes(TASK_WRITE_SCOPE) || scopes.includes(TASK_READ_SCOPE))) return 'production';
  return null;
}
