// @vitest-environment node
import { expect, it } from 'vitest';
import { grantProjectScope, principalProjectIds } from '../../../scripts/mcp-events/project-scope.mjs';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
const v2 = patch => ({ mode: 'production', consentVersion: 2, projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [], aiProjectIds: [], eventProjectIds: [], includeFutureProjects: false, taskScopes: ['tasks:read', 'tasks:write'], ...patch });
it('preserves the original single-project legacy grant without acquiring additional targets', () => {
  expect(grantProjectScope({ mode: 'production', projectId: PILOT_PROJECT })).toEqual({ projectIds: [PILOT_PROJECT], writeProjectIds: [], aiProjectIds: [], eventProjectIds: [PILOT_PROJECT] });
  expect(grantProjectScope({ mode: 'production', projectId: PILOT_PROJECT, taskScopes: ['tasks:read', 'tasks:write'] }).writeProjectIds).toEqual([PILOT_PROJECT]);
});
it('never interprets all-project consent as a wildcard, write permission or event permission', () => {
  expect(grantProjectScope(v2())).toEqual({ projectIds: [PILOT_PROJECT, 'viewer'], writeProjectIds: [], aiProjectIds: [], eventProjectIds: [] });
  expect(principalProjectIds(v2(), 'write')).toEqual([]); expect(principalProjectIds(v2(), 'event')).toEqual([]);
});
it.each([
  { consentVersion: 1 }, { consentVersion: 3 }, { projectId: PILOT_PROJECT }, { includeFutureProjects: true },
  { projectIds: null }, { projectIds: [] }, { projectIds: ['*'] }, { projectIds: ['../other'] }, { projectIds: [5] },
  { projectIds: ['p', 'p'] }, { projectIds: Array.from({ length: 501 }, (_, i) => 'p' + i) },
  { writeProjectIds: ['other'] }, { aiProjectIds: [PILOT_PROJECT] }, { eventProjectIds: ['viewer'] },
  { taskScopes: [] }, { writeProjectIds: [PILOT_PROJECT], taskScopes: ['tasks:read'] },
  { aiProjectIds: undefined }, { writeProjectIds: undefined }, { eventProjectIds: undefined },
])('fails closed on malformed or escalating v2 bindings %j', patch => {
  expect(() => grantProjectScope(v2(patch))).toThrow();
});
it.each(['projectIds', 'writeProjectIds', 'aiProjectIds', 'eventProjectIds', 'includeFutureProjects'])('rejects silently appended %s on legacy bindings', field => {
  expect(() => grantProjectScope({ projectId: PILOT_PROJECT, [field]: field === 'includeFutureProjects' ? false : ['other'] })).toThrow();
});
