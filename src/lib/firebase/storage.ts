import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { getFirebaseStorage } from './config';
import {
  createCommentAttachmentUploadDescriptor,
  createUniqueStorageObjectName,
} from './storageKeys';
import {
  isSupportedProjectImageType,
  PROJECT_IMAGE_UPLOAD_FORMAT_LABEL,
} from '@/lib/utils/projectImageUpload';

export async function uploadFile(
  projectId: string,
  taskId: string,
  file: File
): Promise<{ url: string; name: string; type: string; size: number }> {
  const storage = getFirebaseStorage();
  const fileName = createUniqueStorageObjectName(file.name);
  const filePath = `projects/${projectId}/tasks/${taskId}/attachments/${fileName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);

  return {
    url,
    name: file.name,
    type: file.type,
    size: file.size,
  };
}

export async function deleteFile(
  projectId: string,
  taskId: string,
  fileName: string
): Promise<void> {
  const storage = getFirebaseStorage();
  const filePath = `projects/${projectId}/tasks/${taskId}/attachments/${fileName}`;
  const fileRef = ref(storage, filePath);

  try {
    await deleteObject(fileRef);
  } catch (error) {
    // File might not exist in storage, ignore the error
    console.warn('Failed to delete file from storage:', error);
  }
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'doc';
  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  )
    return 'excel';
  if (
    mimeType === 'application/vnd.ms-powerpoint' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  )
    return 'ppt';
  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed')
    return 'archive';
  return 'file';
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Maximum file size for project icons (5MB)
const MAX_ICON_SIZE = 5 * 1024 * 1024;
export async function uploadProjectIcon(
  projectId: string,
  file: File
): Promise<string> {
  // Validate file type
  if (!isSupportedProjectImageType(file.type)) {
    throw new Error(`画像ファイル（${PROJECT_IMAGE_UPLOAD_FORMAT_LABEL}）のみアップロード可能です`);
  }

  // Validate file size
  if (file.size > MAX_ICON_SIZE) {
    throw new Error('ファイルサイズは5MB以下にしてください');
  }

  const storage = getFirebaseStorage();
  const timestamp = Date.now();
  const extension = file.name.split('.').pop() || 'png';
  const fileName = `icon_${timestamp}.${extension}`;
  const filePath = `projects/${projectId}/icon/${fileName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);

  return url;
}

export async function uploadProjectIconBlob(
  projectId: string,
  blob: Blob
): Promise<string> {
  const storage = getFirebaseStorage();
  const timestamp = Date.now();
  const fileName = `icon_${timestamp}.jpg`;
  const filePath = `projects/${projectId}/icon/${fileName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, blob);
  const url = await getDownloadURL(fileRef);

  return url;
}

export async function deleteProjectIcon(
  projectId: string,
  iconUrl: string
): Promise<void> {
  const storage = getFirebaseStorage();

  try {
    // Extract file path from URL
    const urlPath = new URL(iconUrl).pathname;
    const decodedPath = decodeURIComponent(urlPath);
    // Firebase storage URLs have format: /v0/b/{bucket}/o/{encoded_path}
    const match = decodedPath.match(/\/o\/(.+)$/);
    if (match) {
      const storagePath = match[1].split('?')[0];
      const fileRef = ref(storage, storagePath);
      await deleteObject(fileRef);
    }
  } catch (error) {
    console.warn('Failed to delete project icon from storage:', error);
  }
}

export async function uploadProjectHeaderImageBlob(
  projectId: string,
  blob: Blob
): Promise<string> {
  const storage = getFirebaseStorage();
  const timestamp = Date.now();
  const fileName = `header_${timestamp}.jpg`;
  const filePath = `projects/${projectId}/header/${fileName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, blob);
  const url = await getDownloadURL(fileRef);

  return url;
}

export async function deleteProjectHeaderImage(
  projectId: string,
  headerImageUrl: string
): Promise<void> {
  const storage = getFirebaseStorage();

  try {
    const urlPath = new URL(headerImageUrl).pathname;
    const decodedPath = decodeURIComponent(urlPath);
    const match = decodedPath.match(/\/o\/(.+)$/);
    if (match) {
      const storagePath = match[1].split('?')[0];
      const fileRef = ref(storage, storagePath);
      await deleteObject(fileRef);
    }
  } catch (error) {
    console.warn('Failed to delete project header image from storage:', error);
  }
}

// Maximum file size for comment attachments (10MB)
const MAX_COMMENT_ATTACHMENT_SIZE = 10 * 1024 * 1024;

export async function uploadCommentAttachment(
  projectId: string,
  taskId: string,
  file: File,
  operationId?: string
): Promise<{ id: string; url: string; name: string; type: string; size: number }> {
  // Validate file size
  if (file.size > MAX_COMMENT_ATTACHMENT_SIZE) {
    throw new Error('ファイルサイズは10MB以下にしてください');
  }

  const storage = getFirebaseStorage();
  const { attachmentId, storageFileName } = createCommentAttachmentUploadDescriptor(file.name);
  if (operationId && !/^[a-zA-Z0-9_-]{1,100}$/.test(operationId)) throw new Error('添付の受付番号を確認してください。');
  const fileName = operationId ? `${operationId}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80)}` : storageFileName;
  const filePath = `projects/${projectId}/tasks/${taskId}/comment_attachments/${fileName}`;
  const fileRef = ref(storage, filePath);

  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);

  return {
    id: attachmentId,
    url,
    name: file.name,
    type: file.type,
    size: file.size,
  };
}
