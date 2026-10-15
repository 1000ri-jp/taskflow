import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { parsePdfThumbnailSource, PdfThumbnailSourceError } from '@/lib/pdf/attachmentSource';
import { PdfAttachmentReadError, readAttachmentPdf } from '@/lib/pdf/readAttachmentPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16 * 1024;
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });

async function sourceBody(request: Request) {
  if (new URL(request.url).search || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new PdfThumbnailSourceError();
  }
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new PdfThumbnailSourceError('添付ファイルの指定が大きすぎます。', 413);
  }
  if (!request.body) throw new PdfThumbnailSourceError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        throw new PdfThumbnailSourceError('添付ファイルの指定が大きすぎます。', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return parsePdfThumbnailSource(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))); }
  catch (error) {
    if (error instanceof PdfThumbnailSourceError) throw error;
    throw new PdfThumbnailSourceError();
  }
}

export async function POST(request: Request) {
  let auth;
  try { auth = await authenticateRequest(request.headers.get('authorization')); }
  catch { return failure('ログインを確認してください。', 401); }
  try {
    const source = await sourceBody(request);
    await getProjectAccess(auth.userId, source.projectId, auth.permissions, auth.projectIds, 'tasks:read');
    const bytes = await readAttachmentPdf(source, request.signal);
    return new Response(new Uint8Array(bytes), { headers: { ...headers, 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.byteLength) } });
  } catch (error) {
    if (error instanceof PdfThumbnailSourceError || error instanceof PdfAttachmentReadError) return failure(error.message, error.status);
    const message = error instanceof Error ? error.message : '';
    if (message === 'FORBIDDEN') return failure('このプロジェクトを閲覧する権限がありません。', 403);
    if (message === 'NOT_FOUND') return failure('添付ファイルが見つかりません。', 404);
    return failure('PDFを取得できませんでした。もう一度お試しください。', 503);
  }
}
