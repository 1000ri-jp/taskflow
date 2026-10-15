// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PdfThumbnailSource } from './attachmentSource';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(), fetch: vi.fn(), render: vi.fn(),
  storeUid: 'alice' as string | null, currentUid: 'alice' as string | null, mockAuth: false,
}));
vi.mock('@/lib/firebase/authToken', () => ({ getAuthHeaders: mocks.headers }));
vi.mock('@/lib/firebase/config', () => ({ getFirebaseAuth: () => ({ currentUser: mocks.currentUid ? { uid: mocks.currentUid } : null }) }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => mocks.mockAuth }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: { getState: () => ({ firebaseUser: mocks.storeUid ? { uid: mocks.storeUid } : null }) } }));
vi.mock('./renderThumbnail', () => ({ renderPdfThumbnail: mocks.render }));

let loadPdfThumbnail: typeof import('./thumbnailClient').loadPdfThumbnail;
const authHeaders = { Authorization: 'Bearer private-session-token', 'Content-Type': 'application/json' };
const image = new Blob(['fictitious thumbnail'], { type: 'image/webp' });
const pdf = (id = 'attachment') => new TextEncoder().encode(`%PDF-1.7\nFictitious test PDF ${id}`);
const source = (id = 'attachment'): PdfThumbnailSource => ({
  projectId: 'project', kind: 'comment', taskId: 'task', commentId: 'comment', attachmentId: id,
});
let controllers: AbortController[];
let operations: Promise<unknown>[];
let pendingRejects: ((error: Error) => void)[];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Queued jobs may never consume their gate. Teardown must not create an
  // unhandled rejection when cancelling one of those deliberately unused gates.
  void promise.catch(() => {});
  pendingRejects.push(reject);
  return { promise, resolve, reject };
}

function abortError() { return new DOMException('Cancelled test work', 'AbortError'); }

/** Native fetch and the real renderer reject when their owned signal aborts. */
function whileActive<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const cancel = () => reject(abortError());
    signal.addEventListener('abort', cancel, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

function launch(id = 'attachment', uid = 'alice') {
  const controller = new AbortController();
  controllers.push(controller);
  const promise = loadPdfThumbnail(uid, source(id), controller.signal);
  void promise.catch(() => {});
  operations.push(promise);
  return { promise, controller };
}

async function flush() { for (let step = 0; step < 12; step++) await Promise.resolve(); }

beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks();
  controllers = []; operations = []; pendingRejects = [];
  mocks.storeUid = 'alice'; mocks.currentUid = 'alice'; mocks.mockAuth = false;
  mocks.headers.mockResolvedValue(authHeaders);
  mocks.fetch.mockImplementation(async () => new Response(pdf()));
  mocks.render.mockImplementation(async (_bytes: Uint8Array, signal: AbortSignal) => {
    signal.throwIfAborted(); return image;
  });
  vi.stubGlobal('fetch', mocks.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  ({ loadPdfThumbnail } = await import('./thumbnailClient'));
});
afterEach(async () => {
  controllers.forEach(controller => controller.abort());
  pendingRejects.forEach(reject => reject(abortError()));
  await Promise.allSettled(operations);
  await flush();
  expect(console.error).not.toHaveBeenCalled();
  expect(console.warn).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('PDF thumbnail work queue', () => {
  it('permits at most two download/render jobs and retains each slot until rendering finishes', async () => {
    const downloads = Array.from({ length: 4 }, () => deferred<Response>());
    const renders = Array.from({ length: 4 }, () => deferred<Blob>());
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => {
      const id = Number(JSON.parse(String(init.body)).attachmentId);
      return whileActive(downloads[id].promise, init.signal!);
    });
    mocks.render.mockImplementation((bytes: Uint8Array, signal: AbortSignal) => {
      const id = Number(new TextDecoder().decode(bytes).split(' ').at(-1));
      return whileActive(renders[id].promise, signal);
    });
    const jobs = Array.from({ length: 4 }, (_, index) => launch(String(index)));
    await flush(); expect(mocks.fetch).toHaveBeenCalledTimes(2);

    downloads[0].resolve(new Response(pdf('0'))); downloads[1].resolve(new Response(pdf('1')));
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);

    renders[0].resolve(image); await jobs[0].promise;
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    downloads[2].resolve(new Response(pdf('2')));
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(3));
    expect(mocks.fetch).toHaveBeenCalledTimes(3);

    renders[1].resolve(image); await jobs[1].promise;
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(4));
    downloads[3].resolve(new Response(pdf('3')));
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(4));
    renders[2].resolve(image); renders[3].resolve(image);
    expect(await Promise.all(jobs.map(job => job.promise))).toEqual([image, image, image, image]);
  });

  it('removes an aborted queued job without obtaining a token or starting its fetch', async () => {
    const rendering = deferred<Blob>();
    mocks.render.mockImplementation((_bytes: Uint8Array, signal: AbortSignal) => whileActive(rendering.promise, signal));
    const first = launch('first'), second = launch('second'), queued = launch('never-start');
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    queued.controller.abort();
    await expect(queued.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.headers).toHaveBeenCalledTimes(2); expect(mocks.fetch).toHaveBeenCalledTimes(2);
    rendering.resolve(image); await Promise.all([first.promise, second.promise]); await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts an active token wait, releases its queue slot and ignores the late token', async () => {
    const oldToken = deferred<Record<string, string>>();
    const secondToken = deferred<Record<string, string>>();
    mocks.headers.mockReturnValueOnce(oldToken.promise).mockReturnValueOnce(secondToken.promise);
    const first = launch('cancelled-token'), second = launch('other-token'), next = launch('next');
    await flush(); expect(mocks.headers).toHaveBeenCalledTimes(2);
    first.controller.abort();
    await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(await next.promise).toBe(image);
    oldToken.resolve(authHeaders); await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).attachmentId).toBe('next');
    second.controller.abort(); await expect(second.promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('expires two stalled token waits so a queued job can run, without late-token fetches', async () => {
    vi.useFakeTimers();
    const staleTokens = [deferred<Record<string, string>>(), deferred<Record<string, string>>()];
    mocks.headers.mockReturnValueOnce(staleTokens[0].promise).mockReturnValueOnce(staleTokens[1].promise);
    const jobs = [launch('expired-a'), launch('expired-b'), launch('after-deadline')];
    await flush(); expect(mocks.fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(jobs[0].promise).rejects.toBeInstanceOf(Error);
    await expect(jobs[1].promise).rejects.toBeInstanceOf(Error);
    expect(await jobs[2].promise).toBe(image);
    staleTokens.forEach(token => token.resolve(authHeaders)); await flush();
    expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it('releases failed download and render slots for later jobs without logging', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('offline'));
    mocks.render.mockRejectedValueOnce(new Error('bad PDF'));
    const jobs = [launch('offline'), launch('invalid'), launch('next')];
    const results = await Promise.allSettled(jobs.map(job => job.promise));
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'fulfilled']);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(results[2]).toMatchObject({ value: image });
  });
});

describe('PDF thumbnail account isolation', () => {
  it.each([
    ['storeUid', 'bob'], ['storeUid', null], ['currentUid', 'bob'], ['currentUid', null],
  ] as const)('refuses another or signed-out %s identity before requesting a token', async (field, uid) => {
    mocks[field] = uid;
    await expect(launch().promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.headers).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(['storeUid', 'currentUid'] as const)('rechecks %s after a pending token resolves', async field => {
    const token = deferred<Record<string, string>>(); mocks.headers.mockReturnValueOnce(token.promise);
    const job = launch(); await flush();
    mocks[field] = 'bob'; token.resolve(authHeaders);
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each(['storeUid', 'currentUid'] as const)('does not read a stale response after %s changes', async field => {
    const download = deferred<Response>();
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => whileActive(download.promise, init.signal!));
    const job = launch(); await flush();
    const response = new Response(pdf()); const readBody = vi.spyOn(response, 'arrayBuffer');
    mocks[field] = 'bob'; download.resolve(response);
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(readBody).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each(['storeUid', 'currentUid'] as const)('rejects bytes received after %s changes during body download', async field => {
    const body = deferred<ArrayBuffer>(); const response = new Response(pdf());
    vi.spyOn(response, 'arrayBuffer').mockReturnValue(body.promise); mocks.fetch.mockResolvedValueOnce(response);
    const job = launch(); await vi.waitFor(() => expect(response.arrayBuffer).toHaveBeenCalled());
    mocks[field] = 'bob'; body.resolve(pdf().buffer);
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each(['storeUid', 'currentUid'] as const)('never returns an old image when %s changes during rendering', async field => {
    const rendering = deferred<Blob>();
    mocks.render.mockImplementation((_bytes: Uint8Array, signal: AbortSignal) => whileActive(rendering.promise, signal));
    const job = launch(); await vi.waitFor(() => expect(mocks.render).toHaveBeenCalled());
    mocks[field] = 'bob'; rendering.resolve(image);
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.render.mock.calls[0][1].aborted).toBe(true);
  });

  it('rechecks account ownership when a previously queued job starts', async () => {
    const rendering = deferred<Blob>();
    mocks.render.mockImplementation((_bytes: Uint8Array, signal: AbortSignal) => whileActive(rendering.promise, signal));
    const jobs = [launch('old-a'), launch('old-b'), launch('queued-old-account')];
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    mocks.storeUid = 'bob'; mocks.currentUid = 'bob'; rendering.resolve(image);
    const results = await Promise.allSettled(jobs.map(job => job.promise));
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(mocks.headers).toHaveBeenCalledTimes(2); expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('PDF thumbnail request and cancellation lifecycle', () => {
  it('sends only the saved locator to the same-origin authenticated source endpoint', async () => {
    const job = launch('会場案内.pdf');
    expect(await job.promise).toBe(image);
    const [path, init] = mocks.fetch.mock.calls[0];
    expect(path).toBe('/api/pdf-thumbnail/source');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: authHeaders });
    expect(JSON.parse(init.body)).toEqual(source('会場案内.pdf'));
    expect(init.body).not.toMatch(/https?:|token|\.url|"url"/);
    expect(mocks.render.mock.calls[0][0]).toEqual(pdf());
    expect(init.signal.aborted).toBe(true);
  });

  it('uses no fabricated credential in the isolated mock mode', async () => {
    mocks.mockAuth = true; mocks.currentUid = null;
    expect(await launch().promise).toBe(image);
    expect(mocks.headers).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('does no work for an already aborted request', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(loadPdfThumbnail('alice', source(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.headers).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each(['http', 'declared-size'] as const)('cancels an unread %s response and skips rendering', async reason => {
    const response = new Response(pdf(), reason === 'http'
      ? { status: 403 } : { headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) } });
    const cancel = vi.spyOn(response.body!, 'cancel'); mocks.fetch.mockResolvedValueOnce(response);
    await expect(launch().promise).rejects.toBeInstanceOf(Error);
    expect(cancel).toHaveBeenCalled(); expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each([0, 10 * 1024 * 1024 + 1])('does not render an actual %s-byte response despite a small declared size', async size => {
    mocks.fetch.mockResolvedValueOnce(new Response(new Uint8Array(size), { headers: { 'Content-Length': '1' } }));
    await expect(launch().promise).rejects.toBeInstanceOf(Error);
    expect(mocks.render).not.toHaveBeenCalled(); expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('aborts download work and removes its caller abort listener', async () => {
    const downloaded = deferred<Response>();
    mocks.fetch.mockImplementation((_url: string, init: RequestInit) => whileActive(downloaded.promise, init.signal!));
    const job = launch(); const removed = vi.spyOn(job.controller.signal, 'removeEventListener');
    await flush(); job.controller.abort();
    await expect(job.promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it('propagates cancellation into rendering and frees the queue slot', async () => {
    const rendering = deferred<Blob>();
    mocks.render.mockImplementation((_bytes: Uint8Array, signal: AbortSignal) => whileActive(rendering.promise, signal));
    const first = launch('first'), second = launch('second'), next = launch('next');
    await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
    first.controller.abort(); await expect(first.promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(mocks.render.mock.calls[0][1].aborted).toBe(true);
    rendering.resolve(image); expect(await Promise.all([second.promise, next.promise])).toEqual([image, image]);
  });

  it('expires a stalled download and clears its deadline before later work', async () => {
    vi.useFakeTimers(); const downloaded = deferred<Response>();
    mocks.fetch.mockImplementationOnce((_url: string, init: RequestInit) => whileActive(downloaded.promise, init.signal!));
    const job = launch(); await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    await expect(job.promise).rejects.toBeInstanceOf(Error);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(mocks.render).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(await launch('retry').promise).toBe(image);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['abort', 'deadline'] as const)('stops a stalled response body on %s and never renders its late bytes', async reason => {
    vi.useFakeTimers();
    const body = deferred<ArrayBuffer>(); const response = new Response(pdf('stale-body'));
    vi.spyOn(response, 'arrayBuffer').mockReturnValue(body.promise); mocks.fetch.mockResolvedValueOnce(response);
    const job = launch('stale-body'); await flush();
    expect(response.arrayBuffer).toHaveBeenCalled();
    if (reason === 'abort') job.controller.abort();
    else await vi.advanceTimersByTimeAsync(20_000);
    await expect(job.promise).rejects.toBeInstanceOf(Error);
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    body.resolve(pdf('stale-body').buffer); await flush();
    expect(mocks.render).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    expect(await launch('retry').promise).toBe(image);
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });
});
