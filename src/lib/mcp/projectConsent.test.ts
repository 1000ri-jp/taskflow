// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { taskFirestore } from './taskData.fixture';
import { listConsentProjects } from './projectConsent';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => fake.db }));
let fixture: ReturnType<typeof taskFirestore>;
beforeEach(() => {
  fixture = taskFirestore(); fake.db = fixture.db;
  for (const [id, role] of [[PILOT_PROJECT, 'admin'], ['viewer', 'viewer'], ['editor', 'editor'], ['invalid', 'owner'], ['missing-role', null]]) {
    fixture.records.set('projects/' + id, { memberIds: ['u'], name: String(id), description: 'private detail', isArchived: false });
    if (role) fixture.records.set('projects/' + id + '/members/u', { userId: 'u', role });
  }
  fixture.records.set('projects/foreign', { memberIds: ['someone'], isArchived: false });
  fixture.records.set('projects/archived', { memberIds: ['u'], isArchived: true });
});
it('lists only current readable memberships and selector metadata, including viewer projects', async () => {
  const projects = await listConsentProjects('u');
  expect(new Set(projects.map(p => p.id))).toEqual(new Set([PILOT_PROJECT, 'viewer', 'editor']));
  expect(projects.find(p => p.id === 'viewer')).toMatchObject({ canWrite: false, canWork: false, canNotify: false });
  expect(projects.find(p => p.id === PILOT_PROJECT)).toMatchObject({ canWrite: true, canWork: true, canNotify: true });
  expect(JSON.stringify(projects)).not.toContain('private detail');
});
it('keeps read eligibility after AI restrictions, but prevents write and work choices', async () => {
  fixture.records.set('users/u/settings/aiSettings', { allowedProjectIds: [PILOT_PROJECT] });
  expect((await listConsentProjects('u')).find(p => p.id === 'editor')).toMatchObject({ canWrite: false, canWork: false });
  fixture.records.set('users/u/settings/aiSettings', { allowedProjectIds: 'invalid' });
  expect((await listConsentProjects('u')).every(p => !p.canWrite && !p.canWork)).toBe(true);
});
it('does not trust a stale member array when a role was removed', async () => {
  fixture.records.delete('projects/editor/members/u');
  expect((await listConsentProjects('u')).map(p => p.id)).not.toContain('editor');
});
