// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTaskAutomationJob, runTaskAutoArchiveJob, runTaskMaintenanceJobs } from '../../../scripts/run-task-automation-job.mjs';
const options = { url: 'https://taskflow.example.test', secret: 'x'.repeat(32) };
const response = body => ({ ok: true, json: async () => body });
describe('scheduled TaskFlow worker', () => {
  it('follows each batch cursor, uses POST with no source/user payload, reports failures', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ checked: 20, failed: 0, nextCursor: 'users/u20/secretary/task-automation' })).mockResolvedValueOnce(response({ checked: 4, failed: 1, nextCursor: null }));
    expect(await runTaskAutomationJob({ ...options, fetcher })).toEqual({ checked: 24, failed: 1 });
    const [url, request] = fetcher.mock.calls[1];
    expect(url.pathname).toBe('/api/jobs/task-automation'); expect(url.searchParams.get('cursor')).toBe('users/u20/secretary/task-automation');
    expect(request.method).toBe('POST'); expect(request.body).toBeUndefined(); expect(request.redirect).toBe('error');
  });
  it('refuses a repeated cursor instead of looping', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ checked: 20, failed: 0, nextCursor: 'users/u20/secretary/task-automation' }));
    await expect(runTaskAutomationJob({ ...options, fetcher })).rejects.toThrow('did not advance'); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each(['http://taskflow.example.test', 'https://user:password@taskflow.example.test', 'https://taskflow.example.test?secret=bad'])('rejects insecure or credential-bearing URL %s', async url => {
    const fetcher = vi.fn(); await expect(runTaskAutomationJob({ ...options, url, fetcher })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it('stops on HTTP error without logging response body or secret', async () => {
    await expect(runTaskAutomationJob({ ...options, fetcher: async () => ({ ok: false, status: 503 }) })).rejects.toThrow('HTTP 503');
  });
});

describe('scheduled automatic archive worker', () => {
  it('uses independent project cursors and counts archived tasks separately from checked projects', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ checked: 20, archived: 70, failed: 0, nextCursor: 'projects/p20' }))
      .mockResolvedValueOnce(response({ checked: 3, archived: 8, failed: 1, nextCursor: null }));
    expect(await runTaskAutoArchiveJob({ ...options, fetcher })).toEqual({ checked: 23, archived: 78, failed: 1 });
    const [url, request] = fetcher.mock.calls[1];
    expect(url.pathname).toBe('/api/jobs/task-auto-archive');
    expect(url.searchParams.get('cursor')).toBe('projects/p20');
    expect(request.method).toBe('POST'); expect(request.body).toBeUndefined();
    expect(request.redirect).toBe('error');
  });

  it('accepts an explicit no-op when no shared policy is enabled', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ checked: 0, archived: 0, failed: 0, nextCursor: null }));
    expect(await runTaskAutoArchiveJob({ ...options, fetcher })).toEqual({ checked: 0, archived: 0, failed: 0 });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(['users/u20/secretary/task-automation', 'projects/p20/tasks/task-1', '', 12])('rejects a foreign or malformed archive cursor %s', async nextCursor => {
    const fetcher = vi.fn().mockResolvedValue(response({ checked: 20, archived: 0, failed: 0, nextCursor }));
    await expect(runTaskAutoArchiveJob({ ...options, fetcher })).rejects.toThrow('pagination did not advance');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects repeating project cursors rather than looping', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ checked: 20, archived: 0, failed: 0, nextCursor: 'projects/p20' }));
    await expect(runTaskAutoArchiveJob({ ...options, fetcher })).rejects.toThrow('pagination did not advance');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    { checked: 1, archived: -1, failed: 0, nextCursor: null },
    { checked: 1, archived: 1.2, failed: 0, nextCursor: null },
    { checked: 1, archived: 1, failed: 2, nextCursor: null },
    { checked: 1, failed: 0, nextCursor: null },
    null,
  ])('rejects malformed counters %j', async result => {
    await expect(runTaskAutoArchiveJob({ ...options, fetcher: async () => response(result) })).rejects.toThrow('Unexpected archive worker response');
  });

  it('bounds a large traversal without silently reporting completion', async () => {
    let page = 0;
    const fetcher = vi.fn(async () => response({ checked: 20, archived: 0, failed: 0, nextCursor: `projects/p${++page}` }));
    await expect(runTaskAutoArchiveJob({ ...options, fetcher })).rejects.toThrow('page limit reached');
    expect(fetcher).toHaveBeenCalledTimes(100);
  });

  it.each(['http://taskflow.example.test', 'https://user:password@taskflow.example.test', 'https://taskflow.example.test?secret=bad'])('rejects insecure or credential-bearing archive URL %s', async url => {
    const fetcher = vi.fn(); await expect(runTaskAutoArchiveJob({ ...options, url, fetcher })).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not include server response bodies in HTTP errors', async () => {
    await expect(runTaskAutoArchiveJob({ ...options, fetcher: async () => ({ ok: false, status: 503, json: async () => ({ secret: options.secret }) }) })).rejects.toThrow('HTTP 503');
  });
});

describe('combined scheduled maintenance', () => {
  it('finishes both worker traversals while preserving their distinct cursor formats', async () => {
    const calls = [];
    const fetcher = vi.fn(async endpoint => {
      calls.push(`${endpoint.pathname}?${endpoint.searchParams.get('cursor') ?? ''}`);
      if (endpoint.pathname === '/api/jobs/task-automation') return response(endpoint.searchParams.has('cursor')
        ? { checked: 1, failed: 0, nextCursor: null } : { checked: 20, failed: 0, nextCursor: 'users/u20/secretary/task-automation' });
      return response(endpoint.searchParams.has('cursor')
        ? { checked: 2, archived: 4, failed: 0, nextCursor: null } : { checked: 20, archived: 25, failed: 0, nextCursor: 'projects/p20' });
    });
    expect(await runTaskMaintenanceJobs({ ...options, fetcher })).toEqual({ automation: { checked: 21, failed: 0 }, autoArchive: { checked: 22, archived: 29, failed: 0 }, failed: false });
    expect(calls).toEqual(expect.arrayContaining(['/api/jobs/task-automation?users/u20/secretary/task-automation', '/api/jobs/task-auto-archive?projects/p20']));
  });

  it.each(['/api/jobs/task-automation', '/api/jobs/task-auto-archive'])('still finishes the other worker when %s fails, without logging its error detail', async failedPath => {
    const fetcher = vi.fn(async endpoint => {
      if (endpoint.pathname === failedPath) throw new Error(`private-user and ${options.secret}`);
      return response(endpoint.pathname === '/api/jobs/task-automation'
        ? { checked: 1, failed: 0, nextCursor: null } : { checked: 1, archived: 4, failed: 0, nextCursor: null });
    });
    const result = await runTaskMaintenanceJobs({ ...options, fetcher });
    expect(result.failed).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(failedPath.endsWith('auto-archive') ? result.automation : result.autoArchive).not.toBeNull();
    expect(JSON.stringify(result)).not.toContain(options.secret);
    expect(JSON.stringify(result)).not.toContain('private-user');
  });

  it.each(['/api/jobs/task-automation', '/api/jobs/task-auto-archive'])('fails the scheduled run on reported per-item failures from %s', async failedPath => {
    const fetcher = async endpoint => response({ checked: 1, archived: 0, failed: endpoint.pathname === failedPath ? 1 : 0, nextCursor: null });
    expect((await runTaskMaintenanceJobs({ ...options, fetcher })).failed).toBe(true);
  });

  it.each([false, true])('CLI waits for both mocked jobs and exits nonzero only on failure (%s)', failAutomation => {
    const script = new URL('../../../scripts/run-task-automation-job.mjs', import.meta.url);
    // This child process stubs fetch before importing the CLI; no HTTP requests can leave the test.
    const source = `
      globalThis.fetch = async endpoint => {
        if (endpoint.pathname === '/api/jobs/task-automation' && ${failAutomation}) return { ok: false, status: 503 };
        await new Promise(resolve => setTimeout(resolve, 5));
        return { ok: true, json: async () => endpoint.pathname === '/api/jobs/task-automation'
          ? { checked: 1, failed: 0, nextCursor: null }
          : { checked: 2, archived: 9, failed: 0, nextCursor: null } };
      };
      process.argv[1] = ${JSON.stringify(fileURLToPath(script))};
      await import(${JSON.stringify(script.href)});
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, TASK_AUTOMATION_URL: options.url, TASK_AUTOMATION_JOB_SECRET: options.secret },
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(failAutomation ? 1 : 0);
    const report = JSON.parse(result.stdout);
    expect(report.autoArchive).toEqual({ checked: 2, archived: 9, failed: 0 });
    expect(report.failed).toBe(failAutomation);
    expect(report.automation).toEqual(failAutomation ? null : { checked: 1, failed: 0 });
    expect(result.stdout + result.stderr).not.toContain(options.secret);
  });
});
