/** Browser-only fixtures. Never calls Firebase or the production stamp API. */
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { DEFAULT_SEEN_STAMP, isBuiltInSeenStamp, isCustomSeenStamp, MAX_CUSTOM_STAMPS, MAX_STAMP_IMAGE_BYTES, MAX_STAMP_NAME_LENGTH, STAMP_IMAGE_MIME_TYPES, validateAction, validateId, validateStampRemoval, type CommentReaction, type CustomSeenStampId, type ReactionList, type StampSettings } from './reactions';

export const mockStampSettingsKey = (uid: string) => `taskflow-comment-stamps-mock-v1:${uid}`;
const reactionKey = (projectId: string, taskId: string, commentId: string) => `taskflow-comment-reactions-mock-v1:${projectId}:${taskId}:${commentId}`;
function assertMockUser(uid: string) {
  if (!isE2EMockAuthEnabled() || useAuthStore.getState().user?.id !== uid) throw new Error('ログインを確認してください。');
}
function read<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key);
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { throw new Error('保存済みのスタンプを読み取れませんでした。'); }
}
function settings(uid: string): StampSettings {
  return read(mockStampSettingsKey(uid), { seenStampId: DEFAULT_SEEN_STAMP, customStamps: [] });
}
function save(uid: string, data: StampSettings) {
  assertMockUser(uid);
  localStorage.setItem(mockStampSettingsKey(uid), JSON.stringify(data));
  return data;
}
export async function mockStampRequest<T>(uid: string, path: string, data?: unknown, method?: 'DELETE'): Promise<T> {
  assertMockUser(uid);
  if (path === '/api/comment-stamp-settings/custom' && method === 'DELETE') {
    const id = validateStampRemoval(data as Record<string, unknown>);
    const current = settings(uid);
    if (!current.customStamps?.some(stamp => stamp.id === id)) return current as T;
    return save(uid, { ...current, seenStampId: current.seenStampId === id ? DEFAULT_SEEN_STAMP : current.seenStampId, customStamps: current.customStamps.filter(stamp => stamp.id !== id) }) as T;
  }
  if (path === '/api/comment-stamp-settings') {
    const current = settings(uid);
    if (data === undefined) return current as T;
    const input = data as { seenStampId?: unknown };
    if (Object.keys(input).length !== 1 || !(isBuiltInSeenStamp(input.seenStampId) || current.customStamps?.some(stamp => stamp.id === input.seenStampId))) throw new Error('見たよの絵柄を選択してください。');
    return save(uid, { ...current, seenStampId: input.seenStampId as StampSettings['seenStampId'] }) as T;
  }
  if (path.startsWith('/api/comment-reactions?') && data === undefined) {
    const query = new URL(path, 'http://localhost').searchParams;
    const projectId = query.get('projectId'); const taskId = query.get('taskId');
    validateId(projectId); validateId(taskId);
    const ids = query.getAll('commentId');
    if (!ids.length || ids.length > 20) throw new Error('一度に取得できるコメントは20件までです。');
    const result: Record<string, ReactionList> = {};
    for (const id of ids) {
      validateId(id);
      const rows = read<CommentReaction[]>(reactionKey(projectId, taskId, id), []);
      result[id] = { reactions: rows, own: rows.find(row => row.userId === uid) ?? null, partial: false };
    }
    return result as T;
  }
  if (path === '/api/comment-reactions' && data) {
    const input = validateAction(data as Record<string, unknown>);
    const key = reactionKey(input.projectId, input.taskId, input.commentId);
    const rows = read<CommentReaction[]>(key, []);
    const current = rows.find(row => row.userId === uid) ?? null;
    const marks = { ...current?.marks };
    if (input.active && marks[input.kind] || !input.active && !marks[input.kind]) return { reaction: current } as T;
    if (input.active) {
      const custom = input.kind === 'seen' && isCustomSeenStamp(input.stampId) ? settings(uid).customStamps?.find(stamp => stamp.id === input.stampId) : undefined;
      if (input.kind === 'seen' && isCustomSeenStamp(input.stampId) && !custom) throw new Error('自分のスタンプを選択してください。');
      marks[input.kind] = { stampId: input.stampId, at: new Date().toISOString(), ...(custom ? { customStamp: { name: custom.name, imageUrl: custom.imageUrl } } : {}) };
    } else delete marks[input.kind];
    const reaction: CommentReaction | null = Object.keys(marks).length ? { userId: uid, displayName: useAuthStore.getState().user?.displayName || '本人', marks } : null;
    assertMockUser(uid);
    localStorage.setItem(key, JSON.stringify([...rows.filter(row => row.userId !== uid), ...(reaction ? [reaction] : [])]));
    return { reaction } as T;
  }
  throw new Error('このスタンプ操作は確認環境に対応していません。');
}

/** Store a small preview in this browser, never the full uploaded file in a document. */
export async function mockStampImage(file: File): Promise<string> {
  if (!(STAMP_IMAGE_MIME_TYPES as readonly string[]).includes(file.type) || !file.size || file.size > MAX_STAMP_IMAGE_BYTES) throw new Error('PNG・JPEG・WebPの画像を2MB以下で選んでください。');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('画像の大きさを確認してください。');
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を読み取れませんでした。');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const result = canvas.toDataURL('image/webp', 0.85);
    if (result.length > 150000) throw new Error('もう少し小さい画像を選んでください。');
    return result;
  } finally { URL.revokeObjectURL(url); }
}
export async function uploadMockStamp(uid: string, input: { id: CustomSeenStampId; name: string; file: File }): Promise<StampSettings> {
  assertMockUser(uid);
  const name = input.name.trim();
  if (!isCustomSeenStamp(input.id) || !name || Array.from(name).length > MAX_STAMP_NAME_LENGTH) throw new Error('スタンプの名前を40文字以内で入力してください。');
  const imageUrl = await mockStampImage(input.file);
  assertMockUser(uid);
  const current = settings(uid);
  const stamps = current.customStamps ?? [];
  const existing = stamps.find(stamp => stamp.id === input.id);
  if (existing && (existing.name !== name || existing.imageUrl !== imageUrl)) throw new Error('同じスタンプの内容が変わっています。画像を選び直してください。');
  if (existing) return current;
  if (stamps.length >= MAX_CUSTOM_STAMPS) throw new Error('オリジナルは20個まで登録できます。');
  return save(uid, { seenStampId: input.id, customStamps: [...stamps, { id: input.id, name, imageUrl }] });
}
