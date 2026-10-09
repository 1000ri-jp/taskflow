import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentWritten, onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineBoolean, defineString, defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { createProductionPipeline } from './lib/production.mjs';
import { createSafePost } from './lib/transport.mjs';
import { PILOT_PROJECT } from './lib/policy.mjs';

initializeApp();
const enabled = defineBoolean('SLOWTH_MCP_WORKER_ENABLED', { default: false });
const projectId = defineString('SLOWTH_MCP_EVENTS_PROJECT_ID', { default: 'SlBpu8BPYgIARk4DoYOV' });
const allowedUid = defineString('SLOWTH_MCP_OAUTH_ALLOWED_UID');
const storageKey = defineSecret('SLOWTH_MCP_OAUTH_STORAGE_KEY');
const options = { region: 'asia-northeast1', memory: '256MiB', maxInstances: 1, concurrency: 4,
  timeoutSeconds: 300, secrets: [storageKey],
  serviceAccount: 'firebase-app-hosting-compute@projectmanager-e3308.iam.gserviceaccount.com' };
function pipeline() {
  return createProductionPipeline({ db: getFirestore(), auth: getAuth(),
    config: { enabled: enabled.value(), projectId: projectId.value(), allowedUid: allowedUid.value(),
      clientId: 'https://chatgpt.com/oauth/client.json', resource: 'https://slowth.1000ri.jp/api/mcp' },
    key: Buffer.from(storageKey.value(), 'base64'), post: createSafePost(['connectors.api.openai.com']),
    report: result => result.state === 'dead' ? logger.error('slowth_mcp_delivery', result) : logger.info('slowth_mcp_delivery', result) });
}
export const slowthCaptureTaskChange = onDocumentWritten({ ...options, retry: true,
  document: `projects/${PILOT_PROJECT}/tasks/{taskId}` }, async event => {
  const result = await pipeline().capture({ id: event.id, time: event.time, ...event.params, projectId: PILOT_PROJECT,
    before: event.data?.before.exists ? event.data.before.data() : null,
    after: event.data?.after.exists ? event.data.after.data() : null });
  logger.info('slowth_mcp_capture', result);
});
export const slowthDeliverTaskChange = onDocumentCreated({ ...options, retry: true,
  document: 'mcpEventDeliveries/{deliveryId}' }, async event => {
  await pipeline().process(event.params.deliveryId);
});
export const slowthCaptureTaskDetailChange = onDocumentWritten({ ...options, retry: true,
  document: `projects/${PILOT_PROJECT}/tasks/{taskId}/{resource}/{resourceId}` }, async event => {
  if (!['comments', 'checklists', 'attachments'].includes(event.params.resource)) return;
  const task = await getFirestore().doc(`projects/${PILOT_PROJECT}/tasks/${event.params.taskId}`).get();
  if (!task.exists) return;
  const result = await pipeline().capture({ id: event.id, time: event.time, projectId: PILOT_PROJECT,
    taskId: event.params.taskId, before: task.data(), after: task.data(),
    detail: { resource: event.params.resource, id: event.params.resourceId,
      before: event.data?.before.exists ? event.data.before.data() : null,
      after: event.data?.after.exists ? event.data.after.data() : null } });
  logger.info('slowth_mcp_detail_capture', result);
});
export const slowthRetryTaskChanges = onSchedule({ ...options, schedule: 'every 1 minutes',
  timeZone: 'Asia/Tokyo', retryCount: 0 }, async () => {
  logger.info('slowth_mcp_retry_sweep', await pipeline().sweep());
});
