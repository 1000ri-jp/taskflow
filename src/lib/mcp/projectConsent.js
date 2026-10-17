import { getAdminDb } from '@/lib/firebase/admin';
import { listUserProjects } from '@/lib/firebase/admin-projects';
import { assertProject } from './oidc';
import { PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';

// Selector metadata only. Membership's array and role document must both agree.
export async function listConsentProjects(uid) {
  const projects = await listUserProjects(uid);
  const allowed = (await getAdminDb().doc('users/' + uid + '/settings/aiSettings').get()).data()?.allowedProjectIds;
  const visible = [];
  for (const project of projects) {
    let access;
    try { access = await assertProject(uid, project.id); }
    catch (error) { if (['FORBIDDEN', 'NOT_FOUND'].includes(error.message)) continue; throw error; }
    const canWrite = ['editor', 'admin'].includes(access.role) &&
      (allowed == null || Array.isArray(allowed) && allowed.includes(project.id));
    visible.push({ id: project.id, name: project.name, canWrite, canWork: canWrite, canNotify: project.id === PILOT_PROJECT });
  }
  return visible;
}
