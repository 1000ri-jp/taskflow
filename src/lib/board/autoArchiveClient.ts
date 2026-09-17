'use client';

import { useAuthStore } from '@/stores/authStore';
import type { AutoArchiveRunResult, AutoArchiveSave, AutoArchiveView } from './autoArchiveTypes';

async function request<T>(method: 'GET' | 'PUT' | 'POST', projectId?: string | null, body?: unknown): Promise<T> {
  const initial = useAuthStore.getState();
  const user = initial.firebaseUser;
  if (!user || initial.user?.id !== user.uid) throw new Error('ログインを確認してください。');
  const uid = user.uid;
  const ensureOwner = () => {
    const current = useAuthStore.getState();
    if (current.firebaseUser?.uid !== uid || current.user?.id !== uid) throw new Error('ログインが変更されました。画面を開き直してください。');
  };
  const token = await user.getIdToken();
  ensureOwner();
  const response = await fetch(`/api/auto-archive${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''}`, {
    method, cache: 'no-store', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  ensureOwner();
  const result = await response.json();
  ensureOwner();
  if (!response.ok) throw new Error(result.error || '自動アーカイブを確認できません。');
  return result;
}

export const readAutoArchive = (projectId: string | null) => request<AutoArchiveView>('GET', projectId);
export async function saveAutoArchive(input: AutoArchiveSave) {
  const result = await request<AutoArchiveView>('PUT', null, input);
  window.dispatchEvent(new Event('taskflow-auto-archive-request'));
  return result;
}

/** Follow every project page; authentication is checked again before each request. */
export async function runAutoArchive(shouldContinue: () => boolean = () => true): Promise<void> {
  const uid = useAuthStore.getState().user?.id;
  const seen = new Set<string>();
  let cursor: string | undefined;
  let failed = 0;
  for (let page = 0; page < 100; page++) {
    if (!shouldContinue() || useAuthStore.getState().user?.id !== uid) return;
    const result = await request<AutoArchiveRunResult>('POST', null, { action: 'run', ...(cursor ? { cursor } : {}) });
    failed += result.failed;
    window.dispatchEvent(new Event('taskflow-auto-archive-updated'));
    if (result.nextCursor === null) {
      if (failed) throw new Error('一部のプロジェクトを確認できませんでした。設定画面から結果を確認してください。');
      return;
    }
    if (!/^projects\/[^/\s]{1,200}$/.test(result.nextCursor) || seen.has(result.nextCursor)) throw new Error('自動アーカイブの続きの取得を確認できません。');
    cursor = result.nextCursor;
    seen.add(cursor);
  }
  throw new Error('対象が多いため、残りは次の確認で処理します。');
}
