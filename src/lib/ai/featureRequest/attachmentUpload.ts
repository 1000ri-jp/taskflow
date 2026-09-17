import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from '@/lib/firebase/config';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { annotationFileName, MAX_ANNOTATION_BYTES, type ScreenAnnotation } from './annotations';

// Stable IDs make an explicit retry replace the same attachment, even after a lost response.
export async function uploadRequestAnnotation(uid: string, projectId: string, taskId: string, annotation: ScreenAnnotation): Promise<void> {
  const check = () => {
    if (isE2EMockAuthEnabled()) throw new Error('この検証画面からは送信できません。');
    if (getFirebaseAuth().currentUser?.uid !== uid) throw new Error('アカウントが切り替わりました。開き直してください。');
  };
  check();
  if (!/^[a-f0-9-]{36}$/.test(annotation.id) || annotation.image.type !== 'image/png' || annotation.image.size > MAX_ANNOTATION_BYTES || !annotation.image.size) throw new Error('注釈画像を確認してください。');
  const name = annotationFileName(annotation.id);
  const fileRef = ref(getFirebaseStorage(), `projects/${projectId}/tasks/${taskId}/attachments/annotation-${annotation.id}.png`);
  await uploadBytes(fileRef, annotation.image, { contentType: 'image/png' });
  check();
  const url = await getDownloadURL(fileRef);
  check();
  await setDoc(doc(getFirebaseDb(), 'projects', projectId, 'tasks', taskId, 'attachments', `annotation-${annotation.id}`), { taskId, name, url, type: 'image/png', size: annotation.image.size, uploadedBy: uid, uploadedAt: serverTimestamp() });
  check();
}
