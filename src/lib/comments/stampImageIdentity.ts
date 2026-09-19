import { isCustomSeenStamp, MAX_STAMP_NAME_LENGTH, ReactionError, type CustomSeenStampId } from './reactions';

export function validateCustomStampIdentity(id: unknown, name: unknown): { id: CustomSeenStampId; name: string } {
  if (!isCustomSeenStamp(id)) throw new ReactionError('画像の登録番号を確認してください。');
  if (typeof name !== 'string' || !name.trim() || Array.from(name.trim()).length > MAX_STAMP_NAME_LENGTH || /[\u0000-\u001f\u007f]/.test(name)) throw new ReactionError('名前は1〜40文字で入力してください。');
  return { id, name: name.trim() };
}

export const stampImagePath = (uid: string, id: CustomSeenStampId) => `comment-stamps/${uid}/${id}`;
export const stampImageUrl = (bucket: string, uid: string, id: CustomSeenStampId, token: string) => `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(stampImagePath(uid, id))}?alt=media&token=${encodeURIComponent(token)}`;

export function isOwnedStampImageUrl(value: unknown, uid: string, id: CustomSeenStampId): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    const match = /^\/v0\/b\/([^/]+)\/o\/([^/]+)$/.exec(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'firebasestorage.googleapis.com' && !url.port && !url.username && !url.password && !url.hash && !!match
      && decodeURIComponent(match[2]) === stampImagePath(uid, id) && url.searchParams.get('alt') === 'media'
      && /^[a-f0-9-]{36}$/.test(url.searchParams.get('token') ?? '') && [...url.searchParams.keys()].length === 2;
  } catch { return false; }
}
