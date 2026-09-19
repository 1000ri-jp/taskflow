import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { MOAI_LABEL, MOAI_LABEL_ID } from './moaiLabel';

/** Read before task writes, then commit the label in the same adoption transaction. */
export async function prepareMoaiLabel(db: Firestore, tx: Transaction, projectId: string, now: Date) {
  const labels = db.collection(`projects/${projectId}/labels`);
  const existing = await tx.get(labels.where('name', '==', MOAI_LABEL.name).limit(1));
  if (existing.docs.length) return { id: existing.docs[0].id, write: () => {} };
  const reserved = labels.doc(MOAI_LABEL_ID);
  const current = await tx.get(reserved);
  const ref = current.exists && current.data()?.name !== MOAI_LABEL.name ? labels.doc() : reserved;
  return { id: ref.id, write: () => { if (!current.exists || ref.id !== reserved.id) tx.set(ref, { ...MOAI_LABEL, projectId, createdAt: now }); } };
}
