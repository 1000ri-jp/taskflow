import https from 'node:https';
import { resolve4 } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const denied = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) denied.addSubnet(address, prefix, 'ipv4');

function diagnosticHostname(hostname) {
  // Only ordinary public DNS names may appear in opt-in audit logs.
  if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) return false;
  return !['localhost', 'local', 'localdomain', 'internal', 'lan', 'home', 'home.arpa', 'onion', 'invalid', 'test', 'example']
    .some(suffix => hostname === suffix || hostname.endsWith('.' + suffix));
}

export async function resolveCallback(raw, allowedHosts, resolver = resolve4, onRejectedHost) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      (url.port && url.port !== '443') || isIP(url.hostname)) throw new Error('Callback destination rejected');
  const allowed = allowedHosts.includes(url.hostname);
  // With diagnostics off, do not resolve a destination outside the allowlist.
  if (!allowed && (typeof onRejectedHost !== 'function' || !diagnosticHostname(url.hostname))) {
    throw new Error('Callback destination rejected');
  }
  // IPv4-only fail-closed policy for this first adapter; IPv6-only destinations fail.
  const addresses = await resolver(url.hostname);
  if (!addresses.length || addresses.some(a => isIP(a) !== 4 || denied.check(a, 'ipv4'))) {
    throw new Error('Callback destination rejected');
  }
  if (!allowed) {
    // Hostname only: never pass the URL, payload, credentials or request headers.
    try { onRejectedHost(url.hostname); } catch { /* A logger cannot permit delivery. */ }
    throw new Error('Callback destination rejected');
  }
  return { url, address: addresses[0] };
}

export function createSafePost(allowedHosts, { onRejectedHost } = {}) {
  return async (raw, options) => {
    const signal = options.signal ?? AbortSignal.timeout(10000);
    signal.throwIfAborted();
    const destination = await Promise.race([
      resolveCallback(raw, allowedHosts, resolve4, onRejectedHost),
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ]);
    signal.throwIfAborted();
    const { url, address } = destination;
    return new Promise((resolve, reject) => {
      // Pin resolved IP at connection time. Host and TLS servername stay original.
      // No agents/reused sockets, no environment proxy, and never follow redirects.
      const request = https.request(url, {
        method: 'POST', headers: options.headers, signal, agent: false,
        servername: url.hostname, family: 4,
        lookup: (_hostname, _options, callback) => callback(null, address, 4),
      }, response => {
        let size = 0;
        const chunks = [];
        response.on('error', reject);
        response.on('data', chunk => {
          size += chunk.length;
          if (size > 65536) response.destroy(new Error('Callback response too large'));
          else chunks.push(chunk);
        });
        response.on('end', () => {
          const status = response.statusCode ?? 500;
          resolve({ status, ok: status >= 200 && status < 300,
            json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        });
      });
      request.on('error', reject);
      request.end(options.body);
    });
  };
}
