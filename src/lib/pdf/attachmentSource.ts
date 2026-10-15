type AttachmentIdentity = { projectId: string; attachmentId: string };

/** Identifies saved attachment metadata, never a client-supplied download URL. */
export type PdfThumbnailSource = AttachmentIdentity & (
  | { kind: 'task'; taskId: string }
  | { kind: 'comment'; taskId: string; commentId: string }
  | { kind: 'reference'; referenceId: string }
  | { kind: 'reference-comment'; referenceId: string; commentId: string }
);

export class PdfThumbnailSourceError extends Error {
  constructor(message = '添付ファイルの指定を確認してください。', public status = 400) {
    super(message);
  }
}

// Reference attachment IDs can contain the original Japanese filename.
export function isPdfThumbnailSourceId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 500
    && new TextEncoder().encode(value).byteLength <= 1500
    && value !== '.' && value !== '..' && !/[\/\\\u0000-\u001f\u007f]/.test(value);
}

export function parsePdfThumbnailSource(value: unknown): PdfThumbnailSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PdfThumbnailSourceError();
  const input = value as Record<string, unknown>;
  const common = ['projectId', 'kind', 'attachmentId'];
  let fields: string[];
  switch (input.kind) {
    case 'task': fields = [...common, 'taskId']; break;
    case 'comment': fields = [...common, 'taskId', 'commentId']; break;
    case 'reference': fields = [...common, 'referenceId']; break;
    case 'reference-comment': fields = [...common, 'referenceId', 'commentId']; break;
    default: throw new PdfThumbnailSourceError();
  }
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))
    || fields.some(key => key !== 'kind' && !isPdfThumbnailSourceId(input[key]))) {
    throw new PdfThumbnailSourceError();
  }
  return Object.fromEntries(fields.map(key => [key, input[key]])) as PdfThumbnailSource;
}
