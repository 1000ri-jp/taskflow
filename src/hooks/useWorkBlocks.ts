'use client';

import { useMemo, useSyncExternalStore } from 'react';
import { parseWorkBlocks, workBlockError, workBlockKey, type WorkBlock } from '@/lib/dashboard/work-blocks';

const changed = 'taskflow-work-blocks-changed';
const readError = '!unavailable';
const subscribe = (listener: () => void) => {
  window.addEventListener('storage', listener);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(changed, listener); };
};

export function useWorkBlocks(userId: string | null) {
  const raw = useSyncExternalStore(subscribe, () => {
    if (!userId) return null;
    try { return localStorage.getItem(workBlockKey(userId)); } catch { return readError; }
  }, () => null);
  const state = useMemo(() => {
    try { return { blocks: parseWorkBlocks(raw), error: null }; }
    catch { return { blocks: [] as WorkBlock[], error: '作業時間の保存データを読み取れません。このブラウザの保存設定を確認してください。' }; }
  }, [raw]);
  const update = (transform: (blocks: WorkBlock[]) => WorkBlock[]) => {
    if (!userId) throw new Error('ログインを確認してください。');
    // Read the latest value at save time; preserve work saved from another tab.
    const key = workBlockKey(userId);
    let blocks: WorkBlock[];
    try { blocks = parseWorkBlocks(localStorage.getItem(key)); }
    catch { throw new Error('保存済みの作業時間を読み取れないため、変更していません。'); }
    try { localStorage.setItem(key, JSON.stringify(transform(blocks))); }
    catch { throw new Error('作業時間を保存できませんでした。ブラウザの保存設定を確認してください。'); }
    window.dispatchEvent(new Event(changed));
  };
  return { ...state, save: (block: WorkBlock) => {
    const error = workBlockError(block);
    if (error) throw new Error(error);
    update(blocks => [...blocks.filter(item => item.id !== block.id), block]);
  }, remove: (id: string) => update(blocks => blocks.filter(block => block.id !== id)) };
}
