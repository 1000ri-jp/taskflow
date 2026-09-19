'use client';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { AutomationView } from './automationTypes';
export async function automationRequest(body?: Record<string, unknown>): Promise<AutomationView> {
  if (isE2EMockAuthEnabled()) {
    const uid = useAuthStore.getState().user?.id ?? 'e2e-mock-user';
    const ensureOwner = () => { if ((useAuthStore.getState().user?.id ?? 'e2e-mock-user') !== uid) throw new Error('ログインが変更されました。対象を開き直してください。'); };
    const { mockAutomationRequest } = await import('./automationMock');
    ensureOwner();
    const result = await mockAutomationRequest(uid, body);
    ensureOwner();
    return result;
  }
  const initial = useAuthStore.getState(); const user = initial.firebaseUser;
  if (!user || initial.user?.id !== user.uid) throw new Error('ログインを確認してください。');
  const uid = user.uid;
  const ensureOwner = () => {
    const current = useAuthStore.getState();
    if (current.firebaseUser?.uid !== uid || current.user?.id !== uid) throw new Error('ログインが変更されました。対象を開き直してください。');
  };
  const token = await user.getIdToken(); ensureOwner();
  const response = await fetch('/api/task-automation', { method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  ensureOwner();
  const data = await response.json(); ensureOwner();
  if (!response.ok) throw new Error(data.error ?? '自動更新を確認できません。');
  if (data.errors?.length) throw new Error(data.errors.join(' '));
  return data;
}
