import { createHash, randomUUID } from 'node:crypto';
import { getAdminDb, getAdminStorage } from '@/lib/firebase/admin';
import { assertId, object, TaskDataError } from './taskContract';
import type { TaskOperation, TaskPrincipal } from './taskData';

const MAX_BYTES = 10 * 1024 * 1024;
function bucketName() {
  const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucket || !/^[a-z0-9.-]+$/.test(bucket)) throw new TaskDataError('STORAGE_UNAVAILABLE', '添付ストレージを確認できません。', 503);
  return bucket;
}
export function ownedObject(url: unknown, projectId: string, taskId: string): string {
  let parsed: URL;
  try { parsed = new URL(String(url)); } catch { throw new TaskDataError('EXTERNAL_ATTACHMENT', '外部添付は返されたHTTPS URLから取得してください。'); }
  const prefix = `/v0/b/${bucketName()}/o/`;
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'firebasestorage.googleapis.com' || parsed.port || !parsed.pathname.startsWith(prefix)) throw new TaskDataError('EXTERNAL_ATTACHMENT', '外部添付は返されたHTTPS URLから取得してください。');
  const path = decodeURIComponent(parsed.pathname.slice(prefix.length));
  if (!path.startsWith(`projects/${projectId}/tasks/${taskId}/attachments/`) && !path.startsWith(`projects/${projectId}/tasks/${taskId}/comment_attachments/`) || path.includes('/../') || path.includes('/./') || path.includes('\0')) throw new TaskDataError('FORBIDDEN', 'このタスクの添付ではありません。', 403);
  return path;
}
export function validateUpload(data: Record<string, unknown>) {
  if (Object.keys(data).some(k => !['name', 'type', 'base64', 'sha256', 'purpose'].includes(k)) || typeof data.name !== 'string' || !data.name.trim() || data.name.length > 500 || typeof data.type !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(data.type) || typeof data.base64 !== 'string' || data.base64.length > Math.ceil(MAX_BYTES / 3) * 4 || typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.sha256) || data.purpose !== undefined && !['task', 'comment'].includes(String(data.purpose))) throw new TaskDataError('INVALID_UPLOAD', 'ファイル名・MIME type・base64・SHA256を確認してください。');
  const bytes = Buffer.from(data.base64, 'base64');
  if (bytes.length > MAX_BYTES || bytes.toString('base64') !== data.base64 || createHash('sha256').update(bytes).digest('hex') !== data.sha256) throw new TaskDataError('INVALID_UPLOAD', '添付のサイズ・内容・SHA256が一致しません。');
  return { name: data.name, type: data.type, bytes, sha256: data.sha256, purpose: data.purpose === 'comment' ? 'comment' : 'task' };
}
export async function uploadTaskFile(auth: TaskPrincipal, projectId: string, op: TaskOperation) {
  assertId(op.task_id);
  const data = validateUpload(op.data);
  const task = await getAdminDb().doc(`projects/${projectId}/tasks/${op.task_id}`).get();
  if (!task.exists || task.data()?.isArchived) throw new TaskDataError('NOT_FOUND', '有効なタスクへ添付してください。', 404);
  if (auth.expiresAt <= Date.now()) throw new TaskDataError('AUTHORIZATION_EXPIRED', '接続の有効期限を確認してください。', 401);
  const key = createHash('sha256').update(JSON.stringify([auth.userId, op.id])).digest('hex');
  const id = op.resource_id ?? `mcp-${key.slice(0, 40)}`;
  const path = `projects/${projectId}/tasks/${op.task_id}/${data.purpose === 'comment' ? 'comment_attachments' : 'attachments'}/mcp-${key}`;
  const file = getAdminStorage().bucket(bucketName()).file(path);
  try {
    await file.save(data.bytes, { resumable: false, contentType: data.type, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { metadata: { firebaseStorageDownloadTokens: randomUUID(), mcpSha256: data.sha256, mcpName: data.name, mcpUploader: auth.userId } } });
  } catch (error) { if (!object(error) || Number(error.code) !== 412) throw error; }
  const [metadata] = await file.getMetadata();
  if (metadata.metadata?.mcpSha256 !== data.sha256 || metadata.metadata?.mcpName !== data.name || metadata.contentType !== data.type || Number(metadata.size) !== data.bytes.length || metadata.metadata?.mcpUploader !== auth.userId) throw new TaskDataError('IDEMPOTENCY_CONFLICT', '同じ操作IDで添付の内容を変更できません。', 409);
  const token = metadata.metadata?.firebaseStorageDownloadTokens;
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) throw new TaskDataError('STORAGE_UNAVAILABLE', '添付のURLを確認できません。', 503);
  return { purpose: data.purpose, attachment: { id, name: data.name, type: data.type, size: data.bytes.length,
    url: `https://firebasestorage.googleapis.com/v0/b/${bucketName()}/o/${encodeURIComponent(path)}?alt=media&token=${token}` } };
}
export async function readTaskFile(auth: TaskPrincipal, projectId: string, taskId: string, attachmentId: string, args: Record<string, unknown>) {
  const taskRef = getAdminDb().doc(`projects/${projectId}/tasks/${taskId}`);
  let attachment: Record<string, unknown> | undefined;
  if (args.comment_id !== undefined) {
    assertId(args.comment_id); const comment = (await taskRef.collection('comments').doc(args.comment_id).get()).data();
    attachment = comment?.attachments?.find((a: Record<string, unknown>) => a.id === attachmentId);
  } else attachment = (await taskRef.collection('attachments').doc(attachmentId).get()).data();
  if (!attachment) throw new TaskDataError('NOT_FOUND', '添付が見つかりません。', 404);
  const path = ownedObject(attachment.url, projectId, taskId), offset = args.offset ?? 0, length = args.length ?? 32768;
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(length) || Number(length) < 1 || Number(length) > 32768) throw new TaskDataError('INVALID_INPUT', '取得範囲を確認してください。');
  const file = getAdminStorage().bucket(bucketName()).file(path);
  const [metadata] = await file.getMetadata(), size = Number(metadata.size);
  if (!Number.isSafeInteger(size) || size > MAX_BYTES || Number(offset) > size) throw new TaskDataError('INVALID_INPUT', '添付サイズ・取得範囲を確認してください。');
  const end = Math.min(size, Number(offset) + Number(length));
  const chunks: Buffer[] = [];
  if (end > Number(offset)) for await (const chunk of file.createReadStream({ start: Number(offset), end: end - 1 })) chunks.push(Buffer.from(chunk));
  if (auth.expiresAt <= Date.now()) throw new TaskDataError('AUTHORIZATION_EXPIRED', '接続の有効期限を確認してください。', 401);
  return { id: attachmentId, name: attachment.name, type: attachment.type, size, offset, base64: Buffer.concat(chunks).toString('base64'), next_offset: end < size ? end : null, storage_generation: metadata.generation };
}
