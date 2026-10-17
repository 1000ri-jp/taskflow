import { getAuthHeaders } from '@/lib/firebase/authToken';
import { getFirebaseAuth } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import type { PdfThumbnailSource } from './attachmentSource';
import { renderPdfThumbnail } from './renderThumbnail';

const MAX_BYTES = 10 * 1024 * 1024;
type Job = { start: () => void; cancel: () => void };
const queue: Job[] = [];
let active = 0;
function drain() {
  while (active < 2 && queue.length) queue.shift()!.start();
}
const aborted = () => new DOMException('PDF thumbnail cancelled', 'AbortError');

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(aborted()); }
  return new Promise((resolve, reject) => {
    const cancel = () => reject(aborted());
    signal.addEventListener('abort', cancel, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
  });
}

/** Bound downloads and rendering together; offscreen/unmounted jobs never start. */
function limited<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const job: Job = {
      start: () => {
        signal.removeEventListener('abort', job.cancel);
        if (signal.aborted) { reject(aborted()); return; }
        active += 1;
        void run().then(resolve, reject).finally(() => { active -= 1; drain(); });
      },
      cancel: () => {
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        reject(aborted());
      },
    };
    signal.addEventListener('abort', job.cancel, { once: true });
    queue.push(job);
    drain();
  });
}

export function loadPdfThumbnail(uid: string, source: PdfThumbnailSource, signal: AbortSignal): Promise<Blob> {
  return limited(signal, async () => {
    const mock = isE2EMockAuthEnabled();
    const ensureOwner = () => {
      if (signal.aborted) throw aborted();
      if (useAuthStore.getState().firebaseUser?.uid !== uid
        || (!mock && getFirebaseAuth().currentUser?.uid !== uid)) throw aborted();
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, 20_000);
    try {
      ensureOwner();
      // Local mock tests intercept this request. The server always requires a
      // verified Bearer token; mock mode never enables an unauthenticated API.
      const headers = mock ? { 'Content-Type': 'application/json' }
        : await abortable(getAuthHeaders(), controller.signal);
      ensureOwner();
      const response = await abortable(fetch('/api/pdf-thumbnail/source', {
        method: 'POST', headers, body: JSON.stringify(source), cache: 'no-store',
        credentials: 'same-origin', signal: controller.signal,
      }), controller.signal);
      ensureOwner();
      const length = response.headers.get('content-length');
      if (!response.ok || length !== null && Number(length) > MAX_BYTES) {
        void response.body?.cancel().catch(() => {});
        throw new Error('PDF thumbnail unavailable');
      }
      const bytes = new Uint8Array(await abortable(response.arrayBuffer(), controller.signal));
      ensureOwner();
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('PDF thumbnail unavailable');
      clearTimeout(timeout);
      const image = await renderPdfThumbnail(bytes, controller.signal);
      ensureOwner();
      return image;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      controller.abort();
    }
  });
}
