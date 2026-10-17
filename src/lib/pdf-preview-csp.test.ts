import type { NextConfig } from 'next';
import { expect, it, vi } from 'vitest';

it('permits PDF blobs and the exact Storage origin while retaining other frame and object restrictions', async () => {
  // App Hosting rewrites this module's exports during its production type check.
  const { default: nextConfig } = await vi.importActual<{ default: NextConfig }>('../../next.config');
  const headers = await nextConfig.headers!();
  const globalHeaders = headers.find(rule => rule.source === '/(.*)')!.headers;
  const policy = globalHeaders.find(header => header.key === 'Content-Security-Policy')!.value;
  const directives = new Map(policy.split('; ').map(directive => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }));
  expect(directives.get('frame-src')).toEqual([
    "'self'", 'blob:', 'https://*.firebaseapp.com', 'https://accounts.google.com', 'https://firebasestorage.googleapis.com',
  ]);
  expect(directives.get('object-src')).toEqual(["'none'"]);
  expect(directives.get('default-src')).toEqual(["'self'"]);
  expect(directives.get('script-src')).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://apis.google.com']);
  expect(globalHeaders).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' });
});
