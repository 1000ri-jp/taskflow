'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { isCountdownTarget, type CountdownTarget, type SharedCountdownData } from '@/lib/dashboard/countdown';

export const LOCAL_COUNTDOWN_KEY = 'taskflow.testCountdown.v1';
interface Selection { target: CountdownTarget | null; revision: number }
function readSelection(): Selection {
  const raw = localStorage.getItem(LOCAL_COUNTDOWN_KEY);
  if (!raw) return { target: null, revision: 0 };
  const value = JSON.parse(raw);
  if (!value || (value.target !== null && !isCountdownTarget(value.target)) || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('テスト用の保存設定を読み込めません。');
  return { target: value.target, revision: value.revision };
}

export function useLocalCountdown(tasks: DashboardTask[], tasksLoading: boolean) {
  // The local panel mounts only after the client origin has been resolved.
  const [selection, setSelection] = useState<Selection | null>(() => { try { return readSelection(); } catch { return null; } });
  const [error, setError] = useState<Error | null>(() => selection ? null : new Error('このブラウザの保存設定を読み込めません。'));
  const refresh = useCallback(async () => {
    try { const saved = readSelection(); setSelection(saved); setError(null); return saved; }
    catch { const error = new Error('このブラウザに設定を保存できません。ストレージの利用設定を確認してください。'); setError(error); return null; }
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === LOCAL_COUNTDOWN_KEY || event.key === null) void refresh(); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);
  const resolve = (saved: Selection): SharedCountdownData => {
    if (!saved.target) return { ...saved, task: null, status: 'unset' };
    const task = tasks.find((task) => task.projectId === saved.target!.projectId && task.id === saved.target!.taskId && !task.isArchived);
    if (!task) return { ...saved, task: null, status: 'unavailable' };
    return { ...saved, status: 'ready', task: { title: task.title, projectName: task.projectName, dueDate: task.dueDate && !Number.isNaN(task.dueDate.getTime()) ? task.dueDate.toISOString() : null, isCompleted: task.isCompleted, isAbandoned: task.isAbandoned } };
  };
  return {
    localOnly: true,
    data: selection ? resolve(selection) : undefined,
    isLoading: (!selection && !error) || (Boolean(selection?.target) && tasksLoading),
    error,
    isSaving: false,
    refresh: async () => { const saved = await refresh(); return saved ? { data: resolve(saved), error: null } : { error: new Error('ブラウザの保存設定を確認してください。') }; },
    save: async ({ target, revision }: Selection) => {
      const current = readSelection();
      if (current.revision !== revision) { await refresh(); throw new Error('別のタブで設定が変わりました。設定を開き直してください。'); }
      if (target && !tasks.some((task) => task.id === target.taskId && task.projectId === target.projectId && task.dueDate && !Number.isNaN(task.dueDate.getTime()) && !task.isArchived && !task.isCompleted && !task.isAbandoned)) throw new Error('期限のある未完了タスクを選んでください。');
      const saved = { target, revision: revision + 1 };
      try { localStorage.setItem(LOCAL_COUNTDOWN_KEY, JSON.stringify(saved)); }
      catch { throw new Error('このブラウザに設定を保存できませんでした。'); }
      setSelection(saved); setError(null);
    },
  };
}
