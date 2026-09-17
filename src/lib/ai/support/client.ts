'use client';

import { getAuthHeaders } from '@/lib/firebase/authToken';
import { getFirebaseAuth } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { DEFAULT_AI_SUPPORT, parseSupportProfile, type AISupportProfile } from './profile';

export async function requestAISupport(userId: string, profile?: AISupportProfile): Promise<AISupportProfile> {
  if (isE2EMockAuthEnabled()) {
    const key = `taskflow.aiSupport.mock.${userId}`;
    if (profile) localStorage.setItem(key, JSON.stringify(parseSupportProfile(profile)));
    const saved = localStorage.getItem(key);
    return saved ? parseSupportProfile(JSON.parse(saved)) : { ...DEFAULT_AI_SUPPORT };
  }
  if (getFirebaseAuth().currentUser?.uid !== userId) throw new Error('ログイン中のアカウントを確認してください。');
  const headers = await getAuthHeaders();
  if (getFirebaseAuth().currentUser?.uid !== userId) throw new Error('アカウントが切り替わりました。開き直してください。');
  const response = await fetch('/api/ai/support', { method: profile ? 'PUT' : 'GET', headers, ...(profile ? { body: JSON.stringify(profile) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '手伝い方を取得・保存できませんでした。');
  return parseSupportProfile(data);
}
