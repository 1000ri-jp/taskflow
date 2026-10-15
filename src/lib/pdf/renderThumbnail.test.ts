import { afterEach, beforeEach, expect, it, vi, type MockInstance } from 'vitest';
import { PDFJS_ASSET_BASE, renderPdfThumbnail } from './renderThumbnail';

const api = vi.hoisted(() => ({ getDocument: vi.fn(), createWorker: vi.fn(), options: { workerSrc: '' } }));
vi.mock('pdfjs-dist', () => ({ getDocument: api.getDocument, PDFWorker: { create: api.createWorker }, GlobalWorkerOptions: api.options }));

class BrowserWorker extends EventTarget {
  static instances: BrowserWorker[] = [];
  terminate = vi.fn();
  constructor(public url: string, public options: WorkerOptions) { super(); BrowserWorker.instances.push(this); }
}
const bytes = new TextEncoder().encode('%PDF-1.7\nfictitious unit fixture');
const output = new Blob(['fictitious thumbnail'], { type: 'image/webp' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const never = () => new Promise<void>(() => {});

let rendering: { promise: Promise<void>; cancel: ReturnType<typeof vi.fn> };
let page: { getViewport: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; filterFactory: { destroy: ReturnType<typeof vi.fn> } };
let pdf: { getPage: ReturnType<typeof vi.fn> };
let loading: { promise: Promise<typeof pdf>; destroy: ReturnType<typeof vi.fn> };
let worker: { destroy: ReturnType<typeof vi.fn> };
let encode: MockInstance<HTMLCanvasElement['toBlob']>;

beforeEach(() => {
  vi.clearAllMocks();
  BrowserWorker.instances = [];
  vi.stubGlobal('Worker', BrowserWorker);
  rendering = { promise: Promise.resolve(), cancel: vi.fn() };
  page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(() => rendering), filterFactory: { destroy: vi.fn() },
  };
  pdf = { getPage: vi.fn(async () => page) };
  loading = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => {}) };
  worker = { destroy: vi.fn() };
  api.getDocument.mockReturnValue(loading);
  api.createWorker.mockReturnValue(worker);
  encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(output));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('renders only page one within 512 pixels, retains the input, and releases every owned resource', async () => {
  expect(await renderPdfThumbnail(bytes, new AbortController().signal)).toBe(output);
  expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
  const { canvas, viewport } = page.render.mock.calls[0][0];
  expect(viewport).toEqual({ width: 384, height: 512 });
  expect(api.getDocument.mock.calls[0][0]).toMatchObject({
    disableFontFace: true, enableXfa: false, useSystemFonts: false, useWorkerFetch: true,
    maxImageSize: 16_000_000, canvasMaxAreaInBytes: 16 * 1024 * 1024,
    cMapUrl: new URL(`${PDFJS_ASSET_BASE}/cmaps/`, window.location.href).href,
  });
  const transferred = api.getDocument.mock.calls[0][0].data as Uint8Array;
  expect(transferred).toEqual(bytes);
  expect(transferred.buffer).not.toBe(bytes.buffer);
  expect(bytes.byteLength).toBeGreaterThan(0);
  expect(BrowserWorker.instances[0].url).toBe(`${PDFJS_ASSET_BASE}/pdf.worker.min.mjs`);
  expect(BrowserWorker.instances[0].options).toEqual({ type: 'module' });
  expect(api.createWorker).toHaveBeenCalledWith({ port: BrowserWorker.instances[0] });
  expect(loading.destroy).toHaveBeenCalledTimes(1);
  expect(worker.destroy).toHaveBeenCalledTimes(1);
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(page.filterFactory.destroy).toHaveBeenCalledTimes(1);
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});

it.each([new Uint8Array(), new Uint8Array(10 * 1024 * 1024 + 1)])('rejects empty or oversized PDF bytes before starting a worker', async input => {
  await expect(renderPdfThumbnail(input, new AbortController().signal)).rejects.toThrow('サイズ');
  expect(BrowserWorker.instances).toHaveLength(0);
});

it('does not start a worker if already aborted or aborted before the lazy import finishes', async () => {
  const first = new AbortController(); first.abort();
  await expect(renderPdfThumbnail(bytes, first.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const second = new AbortController();
  const pending = renderPdfThumbnail(bytes, second.signal); second.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(BrowserWorker.instances).toHaveLength(0);
});

it('aborts a stalled load even when graceful destroy never resolves, and ignores the late PDF', async () => {
  const document = deferred<typeof pdf>(); loading.promise = document.promise;
  loading.destroy.mockImplementation(never);
  const controller = new AbortController();
  const pending = renderPdfThumbnail(bytes, controller.signal);
  await vi.waitFor(() => expect(api.getDocument).toHaveBeenCalledTimes(1));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(loading.destroy).toHaveBeenCalledTimes(1);
  expect(worker.destroy).toHaveBeenCalledTimes(1);
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  document.resolve(pdf); await Promise.resolve();
  expect(pdf.getPage).not.toHaveBeenCalled();
});

it('does not render a page returned after abort', async () => {
  const firstPage = deferred<typeof page>(); pdf.getPage.mockReturnValue(firstPage.promise);
  const controller = new AbortController(); const pending = renderPdfThumbnail(bytes, controller.signal);
  await vi.waitFor(() => expect(pdf.getPage).toHaveBeenCalled());
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  firstPage.resolve(page); await Promise.resolve();
  expect(page.render).not.toHaveBeenCalled();
});

it('cancels active rendering and destroys its filter DOM and worker', async () => {
  const renderingDone = deferred<void>(); rendering.promise = renderingDone.promise;
  const controller = new AbortController(); const pending = renderPdfThumbnail(bytes, controller.signal);
  await vi.waitFor(() => expect(page.render).toHaveBeenCalled());
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(rendering.cancel).toHaveBeenCalledTimes(1);
  expect(page.filterFactory.destroy).toHaveBeenCalledTimes(1);
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  renderingDone.resolve(); await Promise.resolve();
  expect(encode).not.toHaveBeenCalled();
});

it('ignores image encoding completed after abort', async () => {
  let finish!: BlobCallback;
  encode.mockImplementation(callback => { finish = callback; });
  const controller = new AbortController(); const pending = renderPdfThumbnail(bytes, controller.signal);
  await vi.waitFor(() => expect(encode).toHaveBeenCalled());
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  finish(output); await Promise.resolve();
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});

it.each(['loading', 'cleanup'])('bounds stalled %s and unresponsive worker destruction to 15 seconds', async stage => {
  vi.useFakeTimers();
  if (stage === 'loading') loading.promise = new Promise(() => {});
  loading.destroy.mockImplementation(never);
  const pending = renderPdfThumbnail(bytes, new AbortController().signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
  await vi.waitFor(() => expect(stage === 'loading' ? api.getDocument : encode).toHaveBeenCalled());
  await vi.advanceTimersByTimeAsync(15_000);
  await rejected;
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
  expect(loading.destroy).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('fails promptly if the native worker cannot start', async () => {
  loading.promise = new Promise(() => {});
  const pending = renderPdfThumbnail(bytes, new AbortController().signal);
  await vi.waitFor(() => expect(api.getDocument).toHaveBeenCalled());
  BrowserWorker.instances[0].dispatchEvent(new Event('error'));
  await expect(pending).rejects.toThrow('描画処理');
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});

it.each([0, -1, NaN, Infinity])('refuses an invalid page dimension %s before allocating a canvas', async width => {
  page.getViewport.mockReturnValue({ width, height: 800 });
  await expect(renderPdfThumbnail(bytes, new AbortController().signal)).rejects.toThrow('ページサイズ');
  expect(page.render).not.toHaveBeenCalled();
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});

it('releases resources after image encoding fails', async () => {
  encode.mockImplementation(callback => callback(null));
  await expect(renderPdfThumbnail(bytes, new AbortController().signal)).rejects.toThrow('画像を生成');
  expect(loading.destroy).toHaveBeenCalledTimes(1);
  expect(BrowserWorker.instances[0].terminate).toHaveBeenCalledTimes(1);
});
