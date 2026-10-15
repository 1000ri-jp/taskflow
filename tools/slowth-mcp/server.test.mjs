import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createClient, handleMessage, TOOLS } from './server.mjs';

// Fictional API only; no real Slowth data or token is used.
function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body: init.body && JSON.parse(init.body) });
    const [status, body] = responses.shift() ?? [200, {}];
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, request: createClient({ baseUrl: 'https://slowth.example/ignored', token: 'tf_fixture', fetchImpl }) };
}
const call = (request, name, args) => handleMessage(request, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('initialize negotiates protocol and lists tools', async () => {
  const { request } = fakeFetch([]);
  const init = await handleMessage(request, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await handleMessage(request, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const list = await handleMessage(request, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map(t => t.name), TOOLS.map(t => t.name));
  const missing = await handleMessage(request, { jsonrpc: '2.0', id: 3, method: 'resources/list' });
  assert.equal(missing.error.code, -32601);
});

test('rejects non-PAT tokens', () => {
  assert.throws(() => createClient({ baseUrl: 'https://slowth.example', token: 'firebase-id-token' }), /tf_/);
});

test('create_task maps fields to the PAT API body', async () => {
  const { calls, request } = fakeFetch([[201, { task: { id: 't1' } }]]);
  const res = await call(request, 'create_task', { project_id: 'p1', title: 'Write docs', list_id: 'l1', priority: 'high', due_date: '2026-10-20', assignee_ids: ['u1'] });
  assert.equal(res.result.isError, undefined);
  assert.deepEqual(calls, [{ url: 'https://slowth.example/api/projects/p1/tasks', method: 'POST', auth: 'Bearer tf_fixture',
    body: { title: 'Write docs', listId: 'l1', priority: 'high', dueDate: '2026-10-20', assigneeIds: ['u1'] } }]);
});

test('update, comment, archive and restore call the matching routes', async () => {
  const { calls, request } = fakeFetch([]);
  await call(request, 'update_task', { project_id: 'p1', task_id: 't1', is_completed: true, list_id: 'done' });
  await call(request, 'add_task_comment', { project_id: 'p1', task_id: 't1', content: 'hi' });
  await call(request, 'archive_task', { project_id: 'p1', task_id: 't1' });
  await call(request, 'restore_task', { project_id: 'p1', task_id: 't1' });
  assert.deepEqual(calls.map(c => `${c.method} ${new URL(c.url).pathname}`), [
    'PATCH /api/projects/p1/tasks/t1', 'POST /api/projects/p1/tasks/t1/comments',
    'DELETE /api/projects/p1/tasks/t1', 'POST /api/projects/p1/tasks/t1/restore']);
  assert.deepEqual(calls[0].body, { listId: 'done', isCompleted: true });
});

test('list_tasks filters locally and limits', async () => {
  const tasks = [
    { id: 'a', title: 'Alpha', listId: 'l1', isCompleted: false },
    { id: 'b', title: 'Beta', description: 'alpha notes', listId: 'l1', isCompleted: true },
    { id: 'c', title: 'Gamma', listId: 'l2', isCompleted: false },
  ];
  const { request } = fakeFetch([[200, { tasks }], [200, { tasks }]]);
  const open = JSON.parse((await call(request, 'list_tasks', { project_id: 'p1', completed: false, limit: 1 })).result.content[0].text);
  assert.deepEqual([open.total, open.returned, open.tasks[0].id], [2, 1, 'a']);
  const searched = JSON.parse((await call(request, 'list_tasks', { project_id: 'p1', list_id: 'l1', query: 'ALPHA' })).result.content[0].text);
  assert.deepEqual(searched.tasks.map(t => t.id), ['a', 'b']);
});

test('API and validation errors become tool errors', async () => {
  const { calls, request } = fakeFetch([[403, { error: 'Forbidden' }]]);
  const forbidden = await call(request, 'list_lists', { project_id: 'p1' });
  assert.equal(forbidden.result.isError, true);
  assert.match(forbidden.result.content[0].text, /403 Forbidden/);
  const badId = await call(request, 'get_project_status', { project_id: '../auth/tokens' });
  assert.equal(badId.result.isError, true);
  const empty = await call(request, 'update_task', { project_id: 'p1', task_id: 't1' });
  assert.equal(empty.result.isError, true);
  assert.equal(calls.length, 1);
});

test('stdio process serves JSON-RPC against an HTTP API', async () => {
  const api = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer tf_fixture');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ projects: [{ id: 'p1', name: 'Fixture' }] }));
  }).listen(0, '127.0.0.1');
  await once(api, 'listening');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    env: { PATH: process.env.PATH, SLOWTH_API_TOKEN: 'tf_fixture', SLOWTH_BASE_URL: `http://127.0.0.1:${api.address().port}` },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_projects', arguments: {} } }) + '\n');
  const [chunk] = await once(child.stdout, 'data');
  child.kill();
  api.close();
  const response = JSON.parse(chunk.toString().split('\n')[0]);
  assert.equal(response.id, 7);
  assert.equal(JSON.parse(response.result.content[0].text).projects[0].name, 'Fixture');
});
