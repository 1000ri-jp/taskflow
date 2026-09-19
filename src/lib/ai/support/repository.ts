import { getAdminDb } from '@/lib/firebase/admin';
import { DEFAULT_AI_SUPPORT, parseSupportProfile, supportInstructions, type AISupportProfile } from './profile';

export async function readAISupportProfile(userId: string): Promise<AISupportProfile> {
  const snapshot = await getAdminDb().doc(`users/${userId}/settings/aiSupport`).get();
  return snapshot.exists ? parseSupportProfile(snapshot.data()) : { ...DEFAULT_AI_SUPPORT };
}

export async function saveAISupportProfile(userId: string, profile: AISupportProfile): Promise<void> {
  await getAdminDb().doc(`users/${userId}/settings/aiSupport`).set(parseSupportProfile(profile));
}

export async function readAISupportInstructions(userId: string, once = ''): Promise<string> {
  return supportInstructions(await readAISupportProfile(userId), once);
}
