import { oidcProvider, oidcConfig, firebaseConsentUser, assertProject, digest } from '@/lib/mcp/oidc';
import { getAdminDb } from '@/lib/firebase/admin';
import { listUserProjects } from '@/lib/firebase/admin-projects';
import { listConsentProjects } from '@/lib/mcp/projectConsent';
import { authorizationMode, TEST_SCOPE, READ_SCOPE, TASK_READ_SCOPE, TASK_WRITE_SCOPE, CONSENT_MS, PILOT_PROJECT } from '../../../scripts/mcp-events/policy.mjs';
import { grantProjectScope, MAX_CONSENT_PROJECTS, PROJECT_CONSENT_VERSION } from '../../../scripts/mcp-events/project-scope.mjs';

export const config = { api: { bodyParser: { sizeLimit: '512kb' } } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
  let stage = 'configuration';
  try {
    const settings = oidcConfig(), provider = oidcProvider();
    if (!['GET', 'POST'].includes(req.method)) { res.status(405).end(); return; }
    if (req.method === 'POST' && (req.headers.origin !== settings.origin ||
        !req.headers['content-type']?.startsWith('application/json'))) { res.status(403).end(); return; }
    stage = 'firebase_authentication';
    const user = await firebaseConsentUser(req.headers.authorization);
    stage = 'interaction_cookie';
    const details = await provider.interactionDetails(req, res);
    const mode = authorizationMode(details.params.scope, settings.productionEnabled, settings.taskAccessEnabled);
    const taskScopes = typeof details.params.scope === 'string' ? details.params.scope.split(' ').filter(s => [TASK_READ_SCOPE, TASK_WRITE_SCOPE].includes(s)) : [];
    const multiple = settings.multiProjectReadEnabled && mode === 'production' && taskScopes.includes(TASK_READ_SCOPE);
    const resourceScope = mode === 'production' ? [READ_SCOPE, ...taskScopes].join(' ') : TEST_SCOPE;
    const requested = req.method === 'GET' ? req.query.interaction : req.body?.interaction;
    if (details.uid !== requested || details.params.client_id !== settings.clientId ||
        details.params.redirect_uri !== settings.redirectUri || details.params.resource !== settings.resource ||
        !mode) {
      console.warn('Slowth MCP consent rejected', { stage: 'interaction_binding' });
      res.status(403).end(); return;
    }
    if (req.method === 'GET') {
      stage = 'project_selector';
      if (multiple) {
        const projects = await listConsentProjects(user.uid);
        res.json({ projects, scope: resourceScope, mode, taskScopes, maxDays: 30,
          consentVersion: PROJECT_CONSENT_VERSION, includeFutureProjects: false, maxProjects: MAX_CONSENT_PROJECTS }); return;
      }
      const projects = (await listUserProjects(user.uid)).filter(p => mode !== 'production' || p.id === PILOT_PROJECT)
        .map(p => ({ id: p.id, name: p.name }));
      res.json({ projects, scope: resourceScope, mode, taskScopes,
        maxDays: mode === 'production' ? 30 : null }); return;
    }
    if (typeof req.body.approve !== 'boolean') { res.status(400).end(); return; }
    if (!req.body.approve) {
      const redirect = await provider.interactionResult(req, res, { error: 'access_denied' }, { mergeWithLastSubmission: false });
      res.json({ redirect }); return;
    }
    stage = 'project_authorization';
    let projectBinding;
    if (multiple) {
      if (Object.keys(req.body).some(key => !['interaction', 'approve', 'consentVersion', 'projectIds', 'writeProjectIds', 'aiProjectIds', 'eventProjectIds', 'includeFutureProjects'].includes(key))) { res.status(400).end(); return; }
      projectBinding = { consentVersion: req.body.consentVersion, includeFutureProjects: req.body.includeFutureProjects,
        projectIds: req.body.projectIds, writeProjectIds: req.body.writeProjectIds, aiProjectIds: req.body.aiProjectIds, eventProjectIds: req.body.eventProjectIds };
      const scope = grantProjectScope({ ...projectBinding, mode, taskScopes });
      const projects = await listConsentProjects(user.uid);
      for (const id of scope.projectIds) {
        const project = projects.find(p => p.id === id);
        if (!project || scope.writeProjectIds.includes(id) && !project.canWrite ||
            scope.aiProjectIds.includes(id) && !project.canWork || scope.eventProjectIds.includes(id) && !project.canNotify) { res.status(403).end(); return; }
      }
    } else {
      if (Object.keys(req.body).some(key => !['interaction', 'approve', 'projectId'].includes(key))) { res.status(400).end(); return; }
      if (mode === 'production' && req.body.projectId !== PILOT_PROJECT) { res.status(403).end(); return; }
      await assertProject(user.uid, req.body.projectId, taskScopes.includes(TASK_WRITE_SCOPE));
      projectBinding = { projectId: req.body.projectId };
    }
    stage = 'consent_storage';
    // One explicit consent per interaction, even for concurrent double-clicks.
    await getAdminDb().collection('mcpOAuthConsents').doc(digest(details.uid)).create({ expiresAt: new Date(Date.now() + 300000) });
    stage = 'grant_storage';
    const grant = new provider.Grant({ accountId: user.uid, clientId: settings.clientId });
    grant.addOIDCScope(details.params.scope); grant.addResourceScope(settings.resource, resourceScope);
    const grantId = await grant.save();
    const expiresAt = new Date(Date.now() + (mode === 'production' ? CONSENT_MS : 900000));
    const binding = {
      userId: user.uid, authTime: user.auth_time, ...projectBinding,
      clientId: settings.clientId, resource: settings.resource, mode, expiresAt, ...(taskScopes.length ? { taskScopes } : {}),
    };
    await getAdminDb().collection('mcpOAuthGrants').doc(digest(grantId)).set(binding);
    if (mode === 'production' && (!multiple || projectBinding.eventProjectIds.length)) {
      const owner = digest(JSON.stringify([user.uid, grantId]));
      // This compatibility projectId is an event routing key, never the read selection.
      const eventBinding = { ...binding }; delete eventBinding.projectId;
      await getAdminDb().collection('mcpEventConnections').doc(owner).set({ ...eventBinding, projectId: PILOT_PROJECT, owner,
        bindingId: digest(grantId), grantRecordId: digest(`Grant:${grantId}`), createdAt: Date.now(), mcpExpiresAt: expiresAt });
    }
    stage = 'interaction_completion';
    const redirect = await provider.interactionResult(req, res, {
      login: { accountId: user.uid, remember: false, ts: user.auth_time }, consent: { grantId },
    }, { mergeWithLastSubmission: false });
    res.json({ redirect });
  } catch {
    // Fixed stage names only: never include exception text, tokens, cookies or account IDs.
    console.warn('Slowth MCP consent rejected', { stage });
    if (!res.headersSent) res.status(403).json({ error: 'Connection could not be authorized. Start again from ChatGPT.' });
  }
}
