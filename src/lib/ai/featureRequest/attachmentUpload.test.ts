import { beforeEach, expect, it, vi } from 'vitest';
import { uploadRequestAnnotation } from './attachmentUpload';
const fake = vi.hoisted(() => ({ uid: 'owner', mock: false, upload: vi.fn(), url: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/firebase/config', () => ({ getFirebaseAuth: () => ({ currentUser: { uid: fake.uid } }), getFirebaseDb: () => 'db', getFirebaseStorage: () => 'storage' }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => fake.mock }));
vi.mock('firebase/storage', () => ({ ref: (_: unknown, path: string) => path, uploadBytes: fake.upload, getDownloadURL: fake.url }));
vi.mock('firebase/firestore', () => ({ doc: (_: unknown, ...path: string[]) => path.join('/'), setDoc: fake.save, serverTimestamp: () => 'server-time' }));
const item = { id: '12345678-1234-1234-1234-123456789abc', pageUrl: 'https://taskflow.example', pageTitle: 'ページ', target: '対象', comment: '要望', rect: { x: 0, y: 0, width: 50, height: 50 }, viewport: { width: 100, height: 100 }, capturedAt: '2026-09-13T10:00:00Z', image: new File(['png'], 'annotation.png', { type: 'image/png' }), preview: 'blob:local' };
beforeEach(() => { vi.clearAllMocks(); fake.uid = 'owner'; fake.mock = false; fake.url.mockResolvedValue('https://storage.example/image'); });
it('retries an interrupted upload at the same existing attachment path and metadata ID', async () => {
  fake.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  await expect(uploadRequestAnnotation('owner', 'p', 'task', item)).rejects.toThrow('offline');
  await uploadRequestAnnotation('owner', 'p', 'task', item);
  expect(fake.upload.mock.calls[0][0]).toBe(fake.upload.mock.calls[1][0]);
  expect(fake.save.mock.calls[0][0]).toBe(fake.save.mock.calls[1][0]);
  expect(fake.save.mock.calls[1]).toEqual([`projects/p/tasks/task/attachments/annotation-${item.id}`, expect.objectContaining({ taskId: 'task', uploadedBy: 'owner', url: 'https://storage.example/image' })]);
});
it('stops on identity change during upload and never writes real storage in mock mode', async () => {
  fake.upload.mockImplementationOnce(async () => { fake.uid = 'other'; });
  await expect(uploadRequestAnnotation('owner', 'p', 'task', item)).rejects.toThrow('アカウント');
  expect(fake.save).not.toHaveBeenCalled();
  fake.mock = true;
  await expect(uploadRequestAnnotation('owner', 'p', 'task', item)).rejects.toThrow('検証画面');
  expect(fake.upload).toHaveBeenCalledTimes(1);
});
