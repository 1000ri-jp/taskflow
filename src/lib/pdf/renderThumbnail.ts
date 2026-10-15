'use client';

import type { PDFDocumentLoadingTask, PDFPageProxy, PDFWorker, RenderTask } from 'pdfjs-dist';

export const PDFJS_ASSET_BASE = '/pdfjs/6.4.299';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_000_000;
const MAX_CANVAS_BYTES = 16 * 1024 * 1024;
const THUMBNAIL_EDGE = 512;
const RENDER_TIMEOUT_MS = 15_000;

/** Render the first page only. The caller keeps ownership of its original PDF bytes. */
export async function renderPdfThumbnail(bytes: Uint8Array, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  if (!bytes.byteLength || bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDFのサイズを確認してください。');

  let nativeWorker: Worker | undefined;
  let worker: PDFWorker | undefined;
  let loadingTask: PDFDocumentLoadingTask | undefined;
  let destroying: Promise<void> | undefined;
  let page: PDFPageProxy | undefined;
  let renderTask: RenderTask | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let stopped: Error | undefined;
  let cleaned = false;
  let rejectStop!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => { rejectStop = reject; });
  const destroyDocument = () => loadingTask ? destroying ??= loadingTask.destroy() : Promise.resolve();

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      renderTask?.cancel();
      // Graceful destruction can wait on a worker that is stalled or still starting.
      // Do not await it: this call owns and terminates the actual browser worker too.
      void destroyDocument().catch(() => {});
      const filters = page?.filterFactory;
      if (filters && 'destroy' in filters && typeof filters.destroy === 'function') filters.destroy();
    } finally {
      try { worker?.destroy(); } finally {
        nativeWorker?.terminate();
        if (canvas) { canvas.width = 0; canvas.height = 0; }
      }
    }
  };
  const stop = (reason: Error) => {
    if (stopped) return;
    stopped = reason;
    rejectStop(reason);
    cleanup();
  };
  const onAbort = () => stop(new DOMException('PDFサムネイルの生成を中止しました。', 'AbortError'));
  const ensureActive = () => { if (stopped) throw stopped; signal.throwIfAborted(); };
  signal.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => stop(new DOMException('PDFサムネイルの生成に時間がかかっています。', 'TimeoutError')), RENDER_TIMEOUT_MS);

  const render = async () => {
    // The package's main resolves to build/pdf.mjs and includes the published API types.
    const pdfjs = await import('pdfjs-dist');
    ensureActive();
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSET_BASE}/pdf.worker.min.mjs`;
    // An explicit owned port prevents PDF.js from falling back to parsing on the main thread.
    nativeWorker = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, { type: 'module' });
    const onWorkerError = () => stop(new Error('PDFの描画処理を開始できませんでした。'));
    nativeWorker.addEventListener('error', onWorkerError, { once: true });
    nativeWorker.addEventListener('messageerror', onWorkerError, { once: true });
    worker = pdfjs.PDFWorker.create({ port: nativeWorker });
    const assetBase = new URL(`${PDFJS_ASSET_BASE}/`, window.location.href).href;
    loadingTask = pdfjs.getDocument({
      data: bytes.slice(), worker,
      cMapUrl: `${assetBase}cmaps/`, cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`, wasmUrl: `${assetBase}wasm/`,
      useWorkerFetch: true, disableFontFace: true, useSystemFonts: false, enableXfa: false,
      maxImageSize: MAX_IMAGE_PIXELS, canvasMaxAreaInBytes: MAX_CANVAS_BYTES,
      stopAtErrors: true,
    });
    const pdf = await loadingTask.promise;
    ensureActive();
    page = await pdf.getPage(1);
    ensureActive();
    const original = page.getViewport({ scale: 1 });
    if (![original.width, original.height].every(value => Number.isFinite(value) && value > 0)) {
      throw new Error('PDFのページサイズを確認できませんでした。');
    }
    const viewport = page.getViewport({ scale: Math.min(1, THUMBNAIL_EDGE / Math.max(original.width, original.height)) });
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.min(THUMBNAIL_EDGE, Math.ceil(viewport.width)));
    canvas.height = Math.max(1, Math.min(THUMBNAIL_EDGE, Math.ceil(viewport.height)));
    renderTask = page.render({ canvas, viewport, background: 'rgb(255,255,255)' });
    await renderTask.promise;
    renderTask = undefined;
    ensureActive();
    const output = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(blob => blob?.size ? resolve(blob) : reject(new Error('PDFの画像を生成できませんでした。')), 'image/webp', 0.85);
    });
    ensureActive();
    // On success allow PDF.js to release its document and hidden filter DOM first.
    // The same overall deadline still force-stops a hung graceful shutdown.
    await destroyDocument();
    ensureActive();
    return output;
  };

  try {
    return await Promise.race([render(), interrupted]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
    cleanup();
  }
}
