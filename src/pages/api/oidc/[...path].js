import { oidcProvider, oidcConfig } from '@/lib/mcp/oidc';
import { mountedCallback } from '../../../../scripts/mcp-events/oidc-provider.mjs';

export const config = { api: { bodyParser: false, externalResolver: true } };
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const settings = oidcConfig();
    // Do not trust arbitrary Host/X-Forwarded-* when the provider creates URLs.
    req.headers.host = new URL(settings.origin).host;
    req.headers['x-forwarded-host'] = new URL(settings.origin).host;
    req.headers['x-forwarded-proto'] = 'https';
    await mountedCallback(oidcProvider(), '/api/oidc')(req, res);
  } catch {
    if (!res.headersSent) res.status(503).json({ error: 'OAuth unavailable' });
    else res.end();
  }
}
