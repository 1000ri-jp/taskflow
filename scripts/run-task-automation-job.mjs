import { pathToFileURL } from 'node:url';

/** A scheduler executes this bounded worker; it follows server pagination without exposing secrets. */
export async function runTaskAutomationJob({ url, secret, fetcher = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Use the HTTPS TaskFlow origin without credentials or query parameters.');
  if (!secret || secret.length < 32) throw new Error('TASK_AUTOMATION_JOB_SECRET must contain at least 32 characters.');
  let cursor = null; const seen = new Set(); let checked = 0; let failed = 0;
  for (let page = 0; page < 100; page++) {
    const endpoint = new URL('/api/jobs/task-automation', base);
    if (cursor) endpoint.searchParams.set('cursor', cursor);
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(290000) });
    if (!response.ok) throw new Error(`TaskFlow worker returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!Number.isSafeInteger(result.checked) || !Number.isSafeInteger(result.failed) || result.checked < 0 || result.failed < 0 || result.failed > result.checked) throw new Error('Unexpected worker response.');
    checked += result.checked; failed += result.failed;
    if (result.nextCursor === null) return { checked, failed };
    if (typeof result.nextCursor !== 'string' || !/^users\/[^/]{1,200}\/secretary\/task-automation$/.test(result.nextCursor) || seen.has(result.nextCursor)) throw new Error('Worker pagination did not advance.');
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new Error('Worker page limit reached. Resume from the server cursor after inspecting the run.');
}

/** Archive projects use a separate cursor, so they never alter the existing user worker's paging. */
export async function runTaskAutoArchiveJob({ url, secret, fetcher = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error('Use the HTTPS TaskFlow origin without credentials or query parameters.');
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('TASK_AUTOMATION_JOB_SECRET must contain at least 32 characters.');
  let cursor = null; const seen = new Set(); let checked = 0; let archived = 0; let failed = 0;
  for (let page = 0; page < 100; page++) {
    const endpoint = new URL('/api/jobs/task-auto-archive', base);
    if (cursor) endpoint.searchParams.set('cursor', cursor);
    const response = await fetcher(endpoint, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(290000) });
    if (!response.ok) throw new Error(`TaskFlow archive worker returned HTTP ${response.status}.`);
    const result = await response.json();
    if (!result || ![result.checked, result.archived, result.failed].every(value => Number.isSafeInteger(value) && value >= 0) || result.failed > result.checked) throw new Error('Unexpected archive worker response.');
    checked += result.checked; archived += result.archived; failed += result.failed;
    if (result.nextCursor === null) return { checked, archived, failed };
    if (typeof result.nextCursor !== 'string' || !/^projects\/[^/]{1,200}$/.test(result.nextCursor) || seen.has(result.nextCursor)) throw new Error('Archive worker pagination did not advance.');
    seen.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new Error('Archive worker page limit reached. Resume from the server cursor after inspecting the run.');
}

/** Both independent jobs must finish before exit; a failure in either makes the scheduled run fail. */
export async function runTaskMaintenanceJobs(options) {
  const [automation, autoArchive] = await Promise.allSettled([
    runTaskAutomationJob(options),
    runTaskAutoArchiveJob(options),
  ]);
  return {
    automation: automation.status === 'fulfilled' ? automation.value : null,
    autoArchive: autoArchive.status === 'fulfilled' ? autoArchive.value : null,
    failed: [automation, autoArchive].some(result => result.status === 'rejected' || result.value.failed > 0),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runTaskMaintenanceJobs({ url: process.env.TASK_AUTOMATION_URL, secret: process.env.TASK_AUTOMATION_JOB_SECRET });
    console.log(JSON.stringify(result));
    if (result.failed) process.exitCode = 1;
  } catch {
    // Never log request headers, source text, user IDs or the secret.
    console.error('TaskFlow maintenance jobs failed.'); process.exitCode = 1;
  }
}
