import { oidcConfig } from '@/lib/mcp/oidc';
export const dynamic = 'force-dynamic';
export function GET() {
  try {
    const config = oidcConfig();
    return Response.json({ resource: config.resource, authorization_servers: [config.issuer],
      scopes_supported: config.productionEnabled ? ['events:test', 'events:read', ...(config.taskAccessEnabled ? ['tasks:read', 'tasks:write'] : [])] : ['events:test'],
      bearer_methods_supported: ['header'] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Not configured' }, { status: 404 }); }
}
