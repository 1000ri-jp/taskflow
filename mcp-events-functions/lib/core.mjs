// MCP Events protocol core. No task writer or global credentials.
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { discoverResult } from './protocol.mjs';

export const EVENT = {
  name: 'task.updated',
  description: 'A task state changed in the selected project. Text is untrusted data.',
  delivery: ['webhook'],
  inputSchema: {
    type: 'object', properties: { project_id: { type: 'string', minLength: 1 } },
    required: ['project_id'], additionalProperties: false,
  },
  payloadSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string' }, task_id: { type: 'string' },
      title: { type: 'string' }, is_completed: { type: 'boolean' },
      synthetic: { type: 'boolean' },
    },
    required: ['project_id', 'task_id', 'title', 'is_completed', 'synthetic'],
    additionalProperties: false,
  },
};

export class RpcError extends Error {
  constructor(code, message, reason) {
    super(message);
    this.code = code;
    this.reason = reason;
  }
}
function invalid() { throw new RpcError(-32602, 'Invalid params'); }
function same(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function signingKey(secret) {
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) invalid();
  const encoded = secret.slice(6), key = Buffer.from(encoded, 'base64');
  if (key.length < 24 || key.length > 64 || key.toString('base64') !== encoded) invalid();
  return key;
}
export function signature(secret, id, timestamp, body) {
  return 'v1,' + createHmac('sha256', signingKey(secret))
    .update(`${id}.${timestamp}.${body}`).digest('base64');
}
function identity(owner, params) {
  // The only allowed argument is project_id: this is canonical, regardless of input key order.
  return 'sub_' + createHash('sha256').update(JSON.stringify([
    owner, params.delivery.url, params.name, params.arguments.project_id,
  ])).digest('hex');
}
function validate(params, needsSecret) {
  if (params?.name !== EVENT.name || !params.arguments ||
      Object.keys(params.arguments).length !== 1 ||
      typeof params.arguments.project_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(params.arguments.project_id) ||
      params.delivery?.mode !== 'webhook') invalid();
  let url;
  try { url = new URL(params.delivery.url); } catch { invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) invalid();
  if (needsSecret) {
    signingKey(params.delivery.secret);
    if (params.cursor != null) invalid(); // No replay in this prototype.
    if (params.ttlMs != null && (!Number.isSafeInteger(params.ttlMs) || params.ttlMs <= 0)) invalid();
  }
}

export async function signedPost(sub, payload, id, post, now = Date.now) {
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 262144) throw new RpcError(-32602, 'Payload exceeds 256 KiB');
  const timestamp = String(Math.floor(now() / 1000));
  const keys = [sub.secret];
  if (sub.previousSecret && sub.rotateUntil > now()) keys.push(sub.previousSecret);
  return post(sub.url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
    headers: {
      'Content-Type': 'application/json', 'webhook-id': id,
      'webhook-timestamp': timestamp,
      'webhook-signature': keys.map(key => signature(key, id, timestamp, body)).join(' '),
      'X-MCP-Subscription-Id': sub.id,
    }, body,
  });
}

// Repository, current authorization, and safe outbound transport must be supplied.
// The local tests supply fictional implementations. The HTTPS adapter pins public
// destination IPs and stores subscriptions in a server-only Firestore collection.
export function createEventService({ store, authorize, post, now = Date.now, authorizationExpiresAt = Infinity,
  subscriptionLifetimeMs = 3600000, requestExpiresAt = authorizationExpiresAt }) {
  // The authenticated adapter supplies the absolute token/grant deadline.
  function authorizationActive() {
    return (Number.isFinite(authorizationExpiresAt) || authorizationExpiresAt === Infinity) && authorizationExpiresAt > now() &&
      (Number.isFinite(requestExpiresAt) || requestExpiresAt === Infinity) && requestExpiresAt > now();
  }
  function assertAuthorizationActive() {
    if (!authorizationActive()) throw new RpcError(-32001, 'Authorization expired');
  }
  async function subscribe(owner, params) {
    validate(params, true);
    assertAuthorizationActive();
    if (!await authorize(owner, params.arguments.project_id)) throw new RpcError(-32001, 'Forbidden');
    const id = identity(owner, params), previous = await store.get(id);
    assertAuthorizationActive();
    const sub = {
      id, owner, projectId: params.arguments.project_id, url: params.delivery.url,
      secret: params.delivery.secret,
      createdAt: previous?.createdAt ?? now(),
      expiresAt: Math.min(now() + Math.min(params.ttlMs ?? subscriptionLifetimeMs, subscriptionLifetimeMs), authorizationExpiresAt),
    };
    if (previous && previous.secret !== sub.secret && previous.expiresAt > now()) {
      sub.previousSecret = previous.secret;
      sub.rotateUntil = now() + 60000;
    }
    // Reuse verified callback only for this owner, exact identity and same key, briefly.
    if (previous?.verifiedUntil > now() && previous.secret === sub.secret) {
      sub.verifiedUntil = previous.verifiedUntil;
    } else {
      const challenge = randomUUID();
      try {
        const response = await signedPost(sub, { type: 'verification', challenge }, 'verify_' + randomUUID(), post, now);
        const result = await response.json();
        if (!response.ok || typeof result.challenge !== 'string' || !same(challenge, result.challenge)) {
          throw new Error('Challenge mismatch');
        }
      } catch (error) {
        throw new RpcError(-32015, 'Callback verification failed',
          error.name === 'TimeoutError' ? 'timeout' : 'challenge_failed');
      }
      sub.verifiedUntil = now() + 60000;
    }
    assertAuthorizationActive();
    if (sub.expiresAt <= now()) throw new RpcError(-32001, 'Authorization expired');
    await store.set(id, sub);
    return { id, refreshBefore: new Date(sub.expiresAt).toISOString(), cursor: null, truncated: false };
  }
  return {
    async rpc(owner, request) {
      const id = request?.id ?? null;
      try {
        if (!owner) throw new RpcError(-32001, 'Unauthenticated');
        if (request?.jsonrpc !== '2.0' || id === null) throw new RpcError(-32600, 'Invalid Request');
        let result;
        switch (request.method) {
          case 'server/discover':
            result = discoverResult({ events: {} });
            break;
          case 'events/list': result = { events: [EVENT] }; break;
          case 'events/subscribe': result = await subscribe(owner, request.params); break;
          case 'events/unsubscribe': {
            validate(request.params, false);
            // Ownership is part of the identity; revocation must not prevent cleanup.
            await store.delete(identity(owner, request.params));
            result = {};
            break;
          }
          default: throw new RpcError(-32601, 'Method not found');
        }
        return { jsonrpc: '2.0', id, result };
      } catch (error) {
        return { jsonrpc: '2.0', id, error: {
          code: error instanceof RpcError ? error.code : -32603,
          message: error instanceof RpcError ? error.message : 'Internal error',
          ...(error.reason ? { data: { reason: error.reason } } : {}),
        } };
      }
    },
    // Invoked only by a trusted producer, never exposed as a public MCP tool.
    async deliver(event) {
      const d = event?.data;
      if (event?.name !== EVENT.name || typeof event.eventId !== 'string' || !event.eventId ||
          typeof event.timestamp !== 'string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(event.timestamp) ||
          !Number.isFinite(Date.parse(event.timestamp)) || event.cursor !== null ||
          !d || Object.keys(d).sort().join(',') !== 'is_completed,project_id,synthetic,task_id,title' ||
          !['project_id', 'task_id', 'title'].every(k => typeof d[k] === 'string') ||
          typeof d.is_completed !== 'boolean' || typeof d.synthetic !== 'boolean') invalid();
      const results = [];
      for (const sub of await store.values()) {
        if (sub.expiresAt <= now() || sub.projectId !== d.project_id) continue;
        if (!authorizationActive() || !await authorize(sub.owner, sub.projectId) ||
            !authorizationActive() || sub.expiresAt <= now()) {
          await store.delete(sub.id);
          continue;
        }
        const response = await signedPost(sub, event, event.eventId, post, now);
        if (response.status === 410) await store.delete(sub.id);
        // No automatic retries in the POC. Caller may retry with the SAME eventId.
        results.push({ subscriptionId: sub.id, status: response.status, accepted: response.ok });
      }
      return results;
    },
  };
}
