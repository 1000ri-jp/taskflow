import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { getAdminStorage } from '@/lib/firebase/admin';
import { MAX_STAMP_IMAGE_BYTES, STAMP_IMAGE_MIME_TYPES, ReactionError, type StampSettings } from './reactions';
import { checkCustomStampRegistration, registerCustomStamp } from './repository';
import { stampImagePath, stampImageUrl, validateCustomStampIdentity } from './stampImageIdentity';

const MAX_BODY_BYTES = MAX_STAMP_IMAGE_BYTES + 64 * 1024;
const FORM_FIELDS = ['id', 'name', 'file'];
const imageError = () => new ReactionError('2MB以下の静止画像（PNG・JPEG・WebP）を選んでください。');

// Bound the stream before formData parses it. Content-Length alone is not authoritative.
export async function customStampForm(request: Request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data;')) throw new ReactionError('画像と名前を指定してください。');
  const length = request.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw imageError();
  if (!request.body) throw imageError();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw imageError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': request.headers.get('Content-Type')! } }).formData(); }
  catch { throw new ReactionError('画像の送信形式を確認してください。'); }
  const keys = [...form.keys()];
  if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(key => !FORM_FIELDS.includes(key))) throw new ReactionError('画像と名前を指定してください。');
  const identity = validateCustomStampIdentity(form.get('id'), form.get('name'));
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size || file.size > MAX_STAMP_IMAGE_BYTES || !STAMP_IMAGE_MIME_TYPES.some(type => type === file.type)) throw imageError();
  return { ...identity, bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type };
}

export async function normalizeStampImage(bytes: Buffer, mimeType: string): Promise<Buffer> {
  if (!bytes.length || bytes.length > MAX_STAMP_IMAGE_BYTES || !STAMP_IMAGE_MIME_TYPES.some(type => type === mimeType)) throw imageError();
  try {
    const input = sharp(bytes, { failOn: 'warning', limitInputPixels: 16 * 1024 * 1024, animated: true });
    const metadata = await input.metadata();
    const expected = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[mimeType];
    if (metadata.format !== expected || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height) throw imageError();
    // APNG animation is not reported as pages by every libvips version.
    if (metadata.format === 'png' && hasPngAnimation(bytes)) throw imageError();
    const output = await input.rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    if (output.length > MAX_STAMP_IMAGE_BYTES) throw imageError();
    return output;
  } catch { throw imageError(); }
}

function hasPngAnimation(bytes: Buffer) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return true;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') return true;
    offset += size + 12;
    if (type === 'IEND') return false;
  }
  return true;
}

export async function uploadCustomStamp(uid: string, input: Awaited<ReturnType<typeof customStampForm>>): Promise<StampSettings> {
  const stamp = validateCustomStampIdentity(input.id, input.name);
  const bytes = await normalizeStampImage(input.bytes, input.mimeType);
  const requestHash = createHash('sha256').update(JSON.stringify([stamp.name, input.mimeType])).update(input.bytes).digest('hex');
  const existing = await checkCustomStampRegistration(uid, stamp, requestHash);
  if (existing) return existing;
  const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (!bucketName) throw new ReactionError('画像の保存先を確認できませんでした。', 503);
  const bucket = getAdminStorage().bucket(bucketName);
  const file = bucket.file(stampImagePath(uid, stamp.id));
  let token: string = randomUUID();
  try {
    await file.save(bytes, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: 'image/png', cacheControl: 'private, max-age=31536000, immutable', metadata: { firebaseStorageDownloadTokens: token, requestHash } },
    });
  } catch (error) {
    // Both a concurrent retry (412) and a lost upload acknowledgement can be recovered.
    // Never overwrite or delete an object: a reaction may already refer to its token.
    let metadata;
    try { [metadata] = await file.getMetadata(); } catch { throw error; }
    if (metadata.metadata?.requestHash !== requestHash) throw new ReactionError('この登録番号には別の画像が保存されています。選び直してください。', 409);
    const savedToken = metadata.metadata?.firebaseStorageDownloadTokens;
    if (metadata.contentType !== 'image/png' || typeof savedToken !== 'string' || !/^[a-f0-9-]{36}$/.test(savedToken)) throw new ReactionError('保存した画像を確認できませんでした。', 503);
    token = savedToken;
  }
  // An interrupted DB commit leaves a reusable immutable image for the same id; retry is safe.
  return registerCustomStamp(uid, { ...stamp, imageUrl: stampImageUrl(bucket.name, uid, stamp.id, token) }, requestHash);
}
