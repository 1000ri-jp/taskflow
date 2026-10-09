import { mkdir, copyFile } from 'node:fs/promises';
const files = ['policy.mjs', 'core.mjs', 'protocol.mjs', 'subscription-store.mjs', 'production.mjs', 'transport.mjs', 'task-fields.generated.mjs'];
await mkdir(new URL('../lib/', import.meta.url), { recursive: true });
for (const file of files) await copyFile(new URL(`../../scripts/mcp-events/${file}`, import.meta.url), new URL(`../lib/${file}`, import.meta.url));
console.log('Prepared shared MCP worker modules.');
