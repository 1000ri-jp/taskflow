// Read-only by default. Explicit stop/resume changes only this MCP notification pilot.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { PILOT_PROJECT } from './policy.mjs';

const command = process.argv[2] ?? 'status';
if (!['status', 'stop', 'resume'].includes(command)) throw new Error('Use status, stop or resume');
initializeApp({ credential: applicationDefault(), projectId: 'projectmanager-e3308' });
const db = getFirestore();
const operations = db.collection('mcpEventOperations').doc('pilot');
if (command !== 'status') await operations.set({ stopped: command === 'stop', changedAt: new Date() });
const states = {};
for (const state of ['pending', 'delivered', 'dead', 'cancelled']) {
  states[state] = (await db.collection('mcpEventDeliveries').where('state', '==', state).count().get()).data().count;
}
const connections = await db.collection('mcpEventConnections').where('projectId', '==', PILOT_PROJECT).get();
console.log(JSON.stringify({ stopped: (await operations.get()).data()?.stopped === true,
  connectionCount: connections.size, deliveryCounts: states }, null, 2));
