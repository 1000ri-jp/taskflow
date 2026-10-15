import { PILOT_PROJECT, TASK_READ_SCOPE, TASK_WRITE_SCOPE } from './policy.mjs';

export const PROJECT_CONSENT_VERSION = 2;
export const MAX_CONSENT_PROJECTS = 500;
const fields = ['projectIds', 'writeProjectIds', 'aiProjectIds', 'eventProjectIds'];
export function validProjectIds(ids, nonempty = false) {
  return Array.isArray(ids) && (!nonempty || ids.length > 0) && ids.length <= MAX_CONSENT_PROJECTS &&
    ids.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) && new Set(ids).size === ids.length;
}

// A snapshot, never a live "all projects" wildcard. Unknown or mixed formats fail closed.
export function grantProjectScope(binding) {
  if (binding?.consentVersion === undefined) {
    if (!validProjectIds([binding?.projectId], true) || fields.some(key => Object.hasOwn(binding, key)) ||
        Object.hasOwn(binding, 'includeFutureProjects')) throw new Error('Invalid project consent');
    const projectIds = [binding.projectId];
    const writeProjectIds = binding.taskScopes?.includes(TASK_READ_SCOPE) && binding.taskScopes?.includes(TASK_WRITE_SCOPE) ? projectIds : [];
    return { projectIds, writeProjectIds, aiProjectIds: writeProjectIds, eventProjectIds: binding.mode === 'production' ? projectIds : [] };
  }
  if (binding.consentVersion !== PROJECT_CONSENT_VERSION || binding.mode !== 'production' ||
      binding.includeFutureProjects !== false || Object.hasOwn(binding, 'projectId') ||
      !fields.every(key => validProjectIds(binding[key], key === 'projectIds')) ||
      !Array.isArray(binding.taskScopes) || new Set(binding.taskScopes).size !== binding.taskScopes.length ||
      !binding.taskScopes.every(scope => [TASK_READ_SCOPE, TASK_WRITE_SCOPE].includes(scope)) || !binding.taskScopes.includes(TASK_READ_SCOPE) ||
      binding.writeProjectIds.length && !binding.taskScopes.includes(TASK_WRITE_SCOPE) ||
      binding.writeProjectIds.some(id => !binding.projectIds.includes(id)) ||
      binding.aiProjectIds.some(id => !binding.writeProjectIds.includes(id)) ||
      binding.eventProjectIds.some(id => !binding.projectIds.includes(id) || id !== PILOT_PROJECT)) throw new Error('Invalid project consent');
  return Object.fromEntries(fields.map(key => [key, [...binding[key]]]));
}

// Principals come from a validated binding. Legacy principals retain only their original scope.
export function principalProjectIds(auth, kind = 'read') {
  if (auth.consentVersion === undefined) return validProjectIds(auth.projectIds) ? auth.projectIds : [];
  if (auth.consentVersion !== PROJECT_CONSENT_VERSION || auth.includeFutureProjects !== false) return [];
  const ids = auth[{ read: 'projectIds', write: 'writeProjectIds', ai: 'aiProjectIds', event: 'eventProjectIds' }[kind]];
  return validProjectIds(ids) ? ids : [];
}
