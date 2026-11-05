import { createHash } from 'node:crypto';

const BODY_LIMIT = 56 * 1024;

// The provider supports an upstream raw body via req.body. Preserve its parser,
// duplicate-parameter checks, client authentication and token validation.
export function coalesceMuseRefresh({ clientId, resource, coalesce, findRefresh }) {
  return async (ctx, next) => {
    if (ctx.path !== '/token' || ctx.method !== 'POST' || !ctx.is('application/x-www-form-urlencoded') ||
        ctx.get('authorization') || ctx.get('dpop') || ctx.get('cookie') ||
        !['utf-8', 'utf8'].includes((ctx.charset ?? 'utf-8').toLowerCase())) return next();
    ctx.set('Cache-Control', 'no-store'); ctx.set('Pragma', 'no-cache');
    const receivedAt = Date.now();
    const chunks = [];
    let size = 0;
    try {
      if (!ctx.req.readable) return next();
      for await (const chunk of ctx.req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > BODY_LIMIT) throw new Error('Body too large');
        chunks.push(chunk);
      }
      if (ctx.request.length !== undefined && ctx.request.length !== size) throw new Error('Body length mismatch');
    } catch {
      ctx.status = 400; ctx.body = { error: 'invalid_request' }; return;
    }
    const raw = Buffer.concat(chunks, size);
    ctx.req.body = raw;
    const params = new URLSearchParams(raw.toString('utf8'));
    if (params.get('client_id') !== clientId || params.get('resource') !== resource ||
        params.get('grant_type') !== 'refresh_token' || !params.get('refresh_token') ||
        [...params.keys()].some(key => params.getAll(key).length !== 1)) return next();
    // Include every form parameter; differing resource/scope/client requests
    // must never receive another request's token response.
    const requestHash = createHash('sha256').update(JSON.stringify([...params].sort())).digest('hex');
    try {
      // Unknown tokens follow the normal rejection path without creating state.
      const refresh = await findRefresh(params.get('refresh_token'));
      if (!refresh || refresh.clientId !== clientId) return next();
      const result = await coalesce(requestHash, receivedAt, async () => {
        await next();
        return { status: ctx.status, body: ctx.body };
      });
      ctx.set('Cache-Control', 'no-store'); ctx.set('Pragma', 'no-cache');
      ctx.status = result.status; ctx.body = result.body;
    } catch {
      ctx.set('Cache-Control', 'no-store'); ctx.set('Retry-After', '1');
      ctx.status = 503; ctx.body = { error: 'temporarily_unavailable' };
    }
  };
}
