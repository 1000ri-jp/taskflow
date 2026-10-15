import { getAdminDb } from '@/lib/firebase/admin';
import { isPdfThumbnailSourceId, parsePdfThumbnailSource, type PdfThumbnailSource } from './attachmentSource';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const READ_TIMEOUT_MS = 15_000;
const DOWNLOAD_HOST = 'firebasestorage.googleapis.com';

export class PdfAttachmentReadError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

const missing = () => new PdfAttachmentReadError('添付ファイルが見つかりません。', 404);
const unavailable = () => new PdfAttachmentReadError('PDFを取得できませんでした。もう一度お試しください。');
const invalidPdf = () => new PdfAttachmentReadError('このファイルをPDFとして表示できません。', 415);
const tooLarge = () => new PdfAttachmentReadError('10MB以下のPDFを指定してください。', 413);

/** Stop waiting on a database/stream operation even when it cannot itself be aborted. */
function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(unavailable());
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(unavailable());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function registeredAttachment(source: PdfThumbnailSource, signal: AbortSignal): Promise<Record<string, unknown>> {
  if (signal.aborted) throw unavailable();
  const project = getAdminDb().collection('projects').doc(source.projectId);
  const parent = source.kind === 'task' || source.kind === 'comment'
    ? project.collection('tasks').doc(source.taskId)
    : project.collection('references').doc(source.referenceId);
  const snapshot = await abortable(parent.get(), signal);
  if (!snapshot.exists) throw missing();
  if (signal.aborted) throw unavailable();
  let attachment: unknown;
  if (source.kind === 'task') {
    const record = await abortable(parent.collection('attachments').doc(source.attachmentId).get(), signal);
    attachment = record.exists ? record.data() : undefined;
  } else {
    const record = source.kind === 'reference'
      ? snapshot.data()
      : (await abortable(parent.collection('comments').doc(source.commentId).get(), signal)).data();
    attachment = Array.isArray(record?.attachments)
      ? record.attachments.find((item: unknown) => item && typeof item === 'object'
        && (item as Record<string, unknown>).id === source.attachmentId)
      : undefined;
  }
  if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) throw missing();
  const metadata = attachment as Record<string, unknown>;
  if (typeof metadata.type !== 'string' || typeof metadata.name !== 'string'
    || (metadata.type.toLowerCase().split(';')[0].trim() !== 'application/pdf' && !/\.pdf$/i.test(metadata.name))) {
    throw invalidPdf();
  }
  return metadata;
}

function downloadUrl(value: unknown): string {
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,221}[a-z0-9]$/.test(bucket)) throw unavailable();
  if (typeof value !== 'string' || value.length > 8192) throw unavailable();
  let url: URL;
  try { url = new URL(value); } catch { throw unavailable(); }
  const prefix = `/v0/b/${bucket}/o/`;
  if (url.protocol !== 'https:' || url.hostname !== DOWNLOAD_HOST || url.port || url.username || url.password
    || url.hash || !url.pathname.startsWith(prefix)) throw unavailable();
  const keys = [...url.searchParams.keys()];
  const token = url.searchParams.get('token');
  if (keys.length !== 2 || !keys.includes('alt') || !keys.includes('token')
    || url.searchParams.get('alt') !== 'media' || !token || !/^[a-zA-Z0-9_-]{1,1024}$/.test(token)) throw unavailable();
  let objectPath: string;
  try { objectPath = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { throw unavailable(); }
  const parts = objectPath.split('/');
  if (parts.length < 6 || parts[0] !== 'projects' || !isPdfThumbnailSourceId(parts[1]) || !isPdfThumbnailSourceId(parts[3])
    || (parts[2] !== 'tasks' && parts[2] !== 'references')
    || (parts[4] !== 'attachments' && !(parts[2] === 'tasks' && parts[4] === 'comment_attachments'))
    || parts.slice(5).some(part => !isPdfThumbnailSourceId(part))) throw unavailable();
  // Saved URLs may still point to their original task/project after a move or
  // reference conversion. Preserve their existing capability, without Admin Storage.
  return value;
}

/** Call only after authenticating and checking access to source.projectId. */
export async function readAttachmentPdf(input: PdfThumbnailSource, requestSignal?: AbortSignal): Promise<Uint8Array> {
  const source = parsePdfThumbnailSource(input);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  requestSignal?.addEventListener('abort', onAbort, { once: true });
  if (requestSignal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const attachment = await registeredAttachment(source, controller.signal);
    if (controller.signal.aborted) throw unavailable();
    const url = downloadUrl(attachment.url);
    // A Firebase download token is the only credential sent to Storage. Never
    // forward the caller's Bearer token, cookies, or follow an upstream redirect.
    const response = await abortable(fetch(url, {
      method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
    }), controller.signal);
    if (response.redirected || !response.ok || !response.body) {
      void response.body?.cancel().catch(() => {});
      throw response.status === 404 ? missing() : unavailable();
    }
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_PDF_BYTES)) {
      void response.body.cancel().catch(() => {});
      throw /^\d+$/.test(declaredLength) ? tooLarge() : unavailable();
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await abortable(reader.read(), controller.signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) throw tooLarge();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (!/%PDF-\d\.\d/.test(new TextDecoder().decode(bytes.subarray(0, 1024)))) throw invalidPdf();
    return bytes;
  } catch (error) {
    if (controller.signal.aborted) throw new PdfAttachmentReadError('PDFの取得に時間がかかっています。もう一度お試しください。', 504);
    if (error instanceof PdfAttachmentReadError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', onAbort);
    controller.abort();
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
