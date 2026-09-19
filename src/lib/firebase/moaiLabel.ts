import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { getFirebaseDb } from './config';
import { MOAI_LABEL, MOAI_LABEL_ID } from '@/lib/task/moaiLabel';

/** Reuse the normal project label; simultaneous AI creations share the reserved fallback ID. */
export async function ensureMoaiLabel(projectId: string): Promise<string> {
  const db = getFirebaseDb();
  const labels = collection(db, 'projects', projectId, 'labels');
  const existing = await getDocs(query(labels, where('name', '==', MOAI_LABEL.name)));
  if (existing.docs.length) return existing.docs[0].id;
  return runTransaction(db, async tx => {
    const reserved = doc(labels, MOAI_LABEL_ID);
    const current = await tx.get(reserved);
    if (current.exists() && current.data().name === MOAI_LABEL.name) return reserved.id;
    // A renamed label belongs to the user. Leave it intact and create a new one.
    const ref = current.exists() ? doc(labels) : reserved;
    tx.set(ref, { ...MOAI_LABEL, projectId, createdAt: serverTimestamp() });
    return ref.id;
  });
}
