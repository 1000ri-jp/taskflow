import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setImmediate } from 'node:timers/promises';
import { CoordinationHost } from './host.mjs';

async function fixture(t) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'slowth-host-status-'));
  t.after(() => fs.rm(stateRoot, { recursive: true, force: true }));
  const query = { where() { return this; }, limit() { return this; }, async get() { return { size: 0, docs: [] }; } };
  const domain = { getAdminDb: () => ({ collection: () => query }), stopCoordinationWorker: async () => {} };
  const host = new CoordinationHost({ domain, worker: { stateRoot, stopActive: async () => ({ signalled: false }) } });
  host.heartbeat = async () => {};
  const read = async () => JSON.parse(await fs.readFile(host.statusFile, 'utf8'));
  return { host, read };
}

test('concurrent heartbeat and work records preserve every field with readable atomic snapshots', async t => {
  const { host, read } = await fixture(t);
  await host.record({ status: 'awaiting_review', review_task_id: 'actual-review' });
  let done = false;
  const writes = Promise.all(Array.from({ length: 20 }, (_, index) => host.record({
    [`heartbeat_${index}`]: index, report: 'current record '.repeat(10000),
  }))).finally(() => { done = true; });
  let observations = 0;
  while (!done) {
    const current = await read();
    assert.equal(current.review_task_id, 'actual-review');
    observations++;
    await setImmediate();
  }
  await writes;
  const current = await read();
  for (let index = 0; index < 20; index++) assert.equal(current[`heartbeat_${index}`], index);
  assert.ok(observations > 0);
  assert.equal((await fs.stat(host.statusFile)).mode & 0o777, 0o600);
});

test('a completed empty scan reports idle without replacing the historical work outcome', async t => {
  const { host, read } = await fixture(t);
  await host.record({ status: 'awaiting_review', job_id: 'accepted-job', last_error: null });
  assert.deepEqual(await host.runOnce(), { dispatched: false, status: 'idle' });
  const current = await read();
  assert.equal(current.status, 'awaiting_review');
  assert.equal(current.job_id, 'accepted-job');
  assert.equal(current.scan_status, 'idle');
  assert.equal(current.active_plan_count, 0);
  assert.ok(Date.parse(current.last_scan_at) >= Date.parse(current.scan_started_at));
});

test('a new host run clears an earlier stop record and records its own stop', async t => {
  const { host, read } = await fixture(t);
  await host.record({ stopped_at: '2000-01-01T00:00:00.000Z', scan_status: 'stopped' });
  host.runOnce = async () => {
    const starting = await read();
    assert.equal(starting.stopped_at, null);
    assert.equal(starting.scan_status, 'starting');
    assert.equal(starting.last_scan_at, null);
    await host.stop();
    return { dispatched: false };
  };
  await host.run();
  const stopped = await read();
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.scan_status, 'stopped');
  assert.ok(Date.parse(stopped.stopped_at) >= Date.parse(stopped.started_at));
});
