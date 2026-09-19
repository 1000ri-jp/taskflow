export const SEEN_STAMPS = [
  { id: 'wave', label: '手をふる', emoji: '👋' },
  { id: 'eyes', label: '見たよ', emoji: '👀' },
  { id: 'flower', label: 'お花', emoji: '🌸' },
  { id: 'cat', label: 'ねこ', emoji: '🐱' },
  { id: 'meruru', label: 'めるる', emoji: null },
] as const;
export type BuiltInSeenStampId = typeof SEEN_STAMPS[number]['id'];
export type CustomSeenStampId = `custom_${string}`;
export type SeenStampId = BuiltInSeenStampId | CustomSeenStampId;
export interface CustomSeenStamp { id: CustomSeenStampId; name: string; imageUrl: string }
export interface StampSettings { seenStampId: SeenStampId; customStamps?: CustomSeenStamp[] }
export const MAX_CUSTOM_STAMPS = 20;
export const MAX_STAMP_NAME_LENGTH = 40;
export const MAX_STAMP_IMAGE_BYTES = 2 * 1024 * 1024;
export const STAMP_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const STAMP_IMAGE_ACCEPT = STAMP_IMAGE_MIME_TYPES.join(',');
export const isCustomSeenStamp = (value: unknown): value is CustomSeenStampId => typeof value === 'string' && /^custom_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const isBuiltInSeenStamp = (value: unknown): value is BuiltInSeenStampId => SEEN_STAMPS.some(stamp => stamp.id === value);
export type ReactionKind = 'seen' | 'thanks' | 'celebrate';
export const REACTION_LABELS: Record<ReactionKind, string> = { seen: '見たよ', thanks: 'ありがとう', celebrate: 'やったね' };
export const DEFAULT_SEEN_STAMP: SeenStampId = 'wave';
export const isSeenStamp = (value: unknown): value is SeenStampId => isBuiltInSeenStamp(value) || isCustomSeenStamp(value);
export interface ReactionMark { stampId: string; at: string; customStamp?: Pick<CustomSeenStamp, 'name' | 'imageUrl'> }
export interface CommentReaction {
  userId: string;
  displayName: string;
  marks: Partial<Record<ReactionKind, ReactionMark>>;
}
export interface ReactionList { reactions: CommentReaction[]; own: CommentReaction | null; partial: boolean }
export interface ReactionTarget { projectId: string; taskId: string; commentId: string }
export interface ReactionAction extends ReactionTarget { kind: ReactionKind; active: boolean; stampId: string }
export class ReactionError extends Error {
  constructor(message: string, public status = 422) { super(message); }
}
export function validateStampRemoval(data: Record<string, unknown>): CustomSeenStampId {
  if (Object.keys(data).length !== 1 || !isCustomSeenStamp(data.id)) throw new ReactionError('削除するオリジナルスタンプを選択してください。');
  return data.id;
}
export function validateId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new ReactionError('対象を確認してください。');
}
export function validateAction(data: Record<string, unknown>): ReactionAction {
  if (Object.keys(data).some(key => !['projectId', 'taskId', 'commentId', 'kind', 'active', 'stampId'].includes(key))) throw new ReactionError('操作内容を確認してください。');
  validateId(data.projectId); validateId(data.taskId); validateId(data.commentId);
  if (!['seen', 'thanks', 'celebrate'].includes(String(data.kind)) || typeof data.active !== 'boolean' ||
    (data.kind === 'seen' ? !isSeenStamp(data.stampId) : data.stampId !== data.kind)) throw new ReactionError('スタンプを選択してください。');
  return data as unknown as ReactionAction;
}
