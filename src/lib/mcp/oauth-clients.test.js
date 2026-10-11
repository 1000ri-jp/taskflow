// @vitest-environment node
import { expect, it, vi, afterEach } from 'vitest';
import { firestoreAdapter } from '../../../scripts/mcp-events/oidc-store.mjs';
import { resolveOAuthClient } from '../../../scripts/mcp-events/oauth-clients.mjs';
import { memoryFirestore } from './firestore.fixture.mjs';

afterEach(() => vi.useRealTimers());
it('encrypts registered clients, retains them across instances, and enforces removal and expiry', async () => {
  const db = memoryFirestore(), key = Buffer.alloc(32, 8), Adapter = firestoreAdapter(db, key);
  const id = 'slowth-claude-00000000-0000-0000-0000-000000000001';
  const metadata = { client_id: id, application_type: 'web', token_endpoint_auth_method: 'none', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] };
  const config = { clientId: 'chatgpt-fixture', claudeEnabled: true };
  const clients = new Adapter('Client');
  await clients.upsert(id, metadata);
  expect(JSON.stringify([...db.records])).not.toContain(metadata.redirect_uris[0]);
  expect(await resolveOAuthClient(db, key, config, id)).toEqual({ id, name: 'Claude' });
  await clients.destroy(id);
  expect(await resolveOAuthClient(db, key, config, id)).toBeNull();
  await clients.upsert(id, metadata);
  const record = [...db.records.values()][0];
  vi.useFakeTimers(); vi.setSystemTime(record.expiresAt);
  expect(await resolveOAuthClient(db, key, config, id)).toBeNull();
});
it('still requires a finite lifetime for every non-client OAuth artifact', async () => {
  const Adapter = firestoreAdapter(memoryFirestore(), Buffer.alloc(32, 8));
  await expect(new Adapter('AccessToken').upsert('fixture', {})).rejects.toThrow('Finite OAuth lifetime required');
});
