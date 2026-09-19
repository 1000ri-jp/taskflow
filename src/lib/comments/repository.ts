import type { Transaction } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import { DEFAULT_SEEN_STAMP, isBuiltInSeenStamp, isCustomSeenStamp, isSeenStamp, MAX_CUSTOM_STAMPS, ReactionError, validateAction, validateId, validateStampRemoval, type CommentReaction, type CustomSeenStamp, type ReactionList, type ReactionTarget, type StampSettings } from './reactions';
import { isOwnedStampImageUrl, validateCustomStampIdentity } from './stampImageIdentity';

const taskPath = (target: Pick<ReactionTarget, 'projectId' | 'taskId'>) => `projects/${target.projectId}/tasks/${target.taskId}`;
const commentPath = (target: ReactionTarget) => `${taskPath(target)}/comments/${target.commentId}`;

async function access(tx: Transaction, uid: string, target: Pick<ReactionTarget, 'projectId' | 'taskId'>) {
  validateId(target.projectId); validateId(target.taskId);
  const db = getAdminDb();
  const [project, member, task] = await Promise.all([
    tx.get(db.doc(`projects/${target.projectId}`)),
    tx.get(db.doc(`projects/${target.projectId}/members/${uid}`)),
    tx.get(db.doc(taskPath(target))),
  ]);
  if (!project.exists || !(project.data()?.memberIds?.includes(uid) || member.exists)) throw new ReactionError('このプロジェクトを表示する権限がありません。', 403);
  if (!task.exists) throw new ReactionError('タスクが見つかりません。', 404);
}

// Client Rules deny this nested collection. All access is through the authenticated API.
// No writes to the comment, task, activity log, notification, or AI state.
export async function readReactions(uid: string, target: Pick<ReactionTarget, 'projectId' | 'taskId'>, commentIds: string[]): Promise<Record<string, ReactionList>> {
  if (!commentIds.length || commentIds.length > 20 || new Set(commentIds).size !== commentIds.length) throw new ReactionError('一度に取得できるコメントは20件までです。');
  commentIds.forEach(validateId);
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    await access(tx, uid, target);
    const result: Record<string, ReactionList> = {};
    for (const commentId of commentIds) {
      const ref = db.doc(commentPath({ ...target, commentId }));
      if (!(await tx.get(ref)).exists) continue;
      const [rows, own] = await Promise.all([tx.get(ref.collection('reactions').limit(201)), tx.get(ref.collection('reactions').doc(uid))]);
      const mine = own.exists ? { ...own.data(), userId: uid } as CommentReaction : null;
      const reactions = rows.docs.slice(0, 200).map(row => ({ ...row.data(), userId: row.id }) as CommentReaction);
      // Even in a large group, the caller can see and undo their own mark.
      if (mine && !reactions.some(row => row.userId === uid)) reactions.push(mine);
      result[commentId] = { reactions, own: mine, partial: rows.size > 200 };
    }
    return result;
  });
}

export async function setReaction(uid: string, raw: Record<string, unknown>): Promise<CommentReaction | null> {
  const input = validateAction(raw);
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    await access(tx, uid, input);
    const comment = db.doc(commentPath(input));
    const ref = comment.collection('reactions').doc(uid);
    const [source, current, profile] = await Promise.all([tx.get(comment), tx.get(ref), tx.get(db.doc(`users/${uid}`))]);
    if (!source.exists) throw new ReactionError('コメントが見つかりません。', 404);
    const previous = current.exists ? { ...current.data(), userId: uid } as CommentReaction : null;
    const marks = { ...previous?.marks };
    // Setting the desired state (rather than toggling) makes an uncertain retry safe.
    if ((input.active && marks[input.kind]) || (!input.active && !marks[input.kind])) return previous;
    if (input.active) {
      let customStamp: Pick<CustomSeenStamp, 'name' | 'imageUrl'> | undefined;
      if (input.kind === 'seen' && isCustomSeenStamp(input.stampId)) {
        const saved = await tx.get(db.doc(stampSettingsPath(uid)));
        const stamp = stampSettingsFromData(uid, saved.data()).customStamps?.find(item => item.id === input.stampId);
        if (!stamp) throw new ReactionError('自分が登録したスタンプを選択してください。', 403);
        customStamp = { name: stamp.name, imageUrl: stamp.imageUrl };
      }
      marks[input.kind] = { stampId: input.stampId, at: new Date().toISOString(), ...(customStamp ? { customStamp } : {}) };
    }
    else delete marks[input.kind];
    if (!Object.keys(marks).length) { tx.delete(ref); return null; }
    const name = profile.data()?.displayName;
    const next: CommentReaction = { userId: uid, displayName: typeof name === 'string' && name.trim() ? name.slice(0, 80) : 'メンバー', marks };
    tx.set(ref, next);
    return next;
  });
}

const stampSettingsPath = (uid: string) => `users/${uid}/settings/commentStamps`;

function stampSettingsFromData(uid: string, data?: Record<string, unknown>): StampSettings {
  const raw = data?.customStamps;
  let customStamps: CustomSeenStamp[] | undefined;
  if (raw !== undefined) {
    if (!Array.isArray(raw) || raw.length > MAX_CUSTOM_STAMPS) throw new ReactionError('登録したスタンプを取得できませんでした。', 503);
    customStamps = raw.map(item => {
      try {
        const stamp = validateCustomStampIdentity(item?.id, item?.name);
        if (!isOwnedStampImageUrl(item.imageUrl, uid, stamp.id)) throw new Error('invalid image');
        return { ...stamp, imageUrl: item.imageUrl };
      } catch { throw new ReactionError('登録したスタンプを取得できませんでした。', 503); }
    });
    if (new Set(customStamps.map(item => item.id)).size !== customStamps.length) throw new ReactionError('登録したスタンプを取得できませんでした。', 503);
  }
  const seenStampId = isBuiltInSeenStamp(data?.seenStampId) ? data.seenStampId : customStamps?.find(item => item.id === data?.seenStampId)?.id ?? DEFAULT_SEEN_STAMP;
  return { seenStampId, ...(customStamps ? { customStamps } : {}) };
}
export async function readStampSettings(uid: string): Promise<StampSettings> {
  const saved = await getAdminDb().doc(stampSettingsPath(uid)).get();
  return stampSettingsFromData(uid, saved.data());
}
export async function saveStampSettings(uid: string, data: Record<string, unknown>): Promise<StampSettings> {
  if (Object.keys(data).length !== 1 || !isSeenStamp(data.seenStampId)) throw new ReactionError('見たよの絵柄を選択してください。');
  const seenStampId = data.seenStampId;
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(stampSettingsPath(uid));
    const saved = (await tx.get(ref)).data();
    const settings = stampSettingsFromData(uid, saved);
    if (isCustomSeenStamp(seenStampId) && !settings.customStamps?.some(item => item.id === seenStampId)) throw new ReactionError('自分が登録したスタンプを選択してください。', 403);
    tx.set(ref, { ...saved, seenStampId });
    return { ...settings, seenStampId };
  });
}

/** Remove only the owner's catalog entry. Posted reactions retain their image snapshots. */
export async function removeCustomStamp(uid: string, data: Record<string, unknown>): Promise<StampSettings> {
  const id = validateStampRemoval(data);
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(stampSettingsPath(uid));
    const saved = (await tx.get(ref)).data();
    const settings = stampSettingsFromData(uid, saved);
    // A retry after a lost acknowledgement must not reset a newer favorite.
    if (!settings.customStamps?.some(stamp => stamp.id === id)) return settings;
    const customStamps = (saved!.customStamps as Record<string, unknown>[]).filter(stamp => stamp.id !== id);
    const seenStampId = settings.seenStampId === id ? DEFAULT_SEEN_STAMP : settings.seenStampId;
    const next = { ...saved, customStamps, seenStampId };
    tx.set(ref, next);
    return stampSettingsFromData(uid, next);
  });
}

function existingRegistration(uid: string, data: Record<string, unknown> | undefined, stamp: Pick<CustomSeenStamp, 'id' | 'name'>, requestHash: string): StampSettings | null {
  const settings = stampSettingsFromData(uid, data);
  const existing = settings.customStamps?.find(item => item.id === stamp.id);
  if (existing) {
    const raw = (data!.customStamps as Record<string, unknown>[]).find(item => item.id === stamp.id);
    if (existing.name !== stamp.name || raw?.requestHash !== requestHash) throw new ReactionError('この登録番号には別の画像が保存されています。選び直してください。', 409);
    return settings;
  }
  if ((settings.customStamps?.length ?? 0) >= MAX_CUSTOM_STAMPS) throw new ReactionError('オリジナルスタンプは20点まで登録できます。');
  return null;
}

// Retry checks do not reselect an old upload after the person has changed their favorite.
export async function checkCustomStampRegistration(uid: string, stamp: Pick<CustomSeenStamp, 'id' | 'name'>, requestHash: string): Promise<StampSettings | null> {
  const saved = await getAdminDb().doc(stampSettingsPath(uid)).get();
  return existingRegistration(uid, saved.data(), stamp, requestHash);
}

export async function registerCustomStamp(uid: string, stamp: CustomSeenStamp, requestHash: string): Promise<StampSettings> {
  validateCustomStampIdentity(stamp.id, stamp.name);
  if (!isOwnedStampImageUrl(stamp.imageUrl, uid, stamp.id) || !/^[a-f0-9]{64}$/.test(requestHash)) throw new ReactionError('画像の登録内容を確認してください。');
  const db = getAdminDb();
  return db.runTransaction(async tx => {
    const ref = db.doc(stampSettingsPath(uid));
    const saved = (await tx.get(ref)).data();
    const previous = existingRegistration(uid, saved, stamp, requestHash);
    if (previous) return previous;
    const customStamps = [...((saved?.customStamps as Record<string, unknown>[] | undefined) ?? []), { ...stamp, requestHash }];
    const next = { ...saved, customStamps, seenStampId: stamp.id };
    tx.set(ref, next);
    return stampSettingsFromData(uid, next);
  });
}
