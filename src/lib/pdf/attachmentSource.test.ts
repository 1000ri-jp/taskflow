import { describe, expect, it } from 'vitest';
import { parsePdfThumbnailSource } from './attachmentSource';

const base = { projectId: 'project', attachmentId: '1720_uuid_会場案内.pdf' };

describe('saved PDF thumbnail source', () => {
  it.each([
    { ...base, kind: 'task', taskId: 'task' },
    { ...base, kind: 'comment', taskId: 'task', commentId: 'comment' },
    { ...base, kind: 'reference', referenceId: 'reference' },
    { ...base, kind: 'reference-comment', referenceId: 'reference', commentId: 'comment' },
  ])('accepts the exact $kind locator, including Japanese filenames', input => {
    expect(parsePdfThumbnailSource(input)).toEqual(input);
  });

  it.each([
    null, [], {},
    { ...base, kind: 'url', url: 'https://example.test/private.pdf' },
    { ...base, kind: 'task' },
    { ...base, kind: 'comment', taskId: 'task' },
    { ...base, kind: 'reference-comment', referenceId: 'reference' },
    { ...base, kind: 'task', taskId: 'task', referenceId: 'reference' },
    { ...base, kind: 'task', taskId: 'task', commentId: 'comment' },
    { ...base, kind: 'task', taskId: 'task', url: 'https://example.test/file.pdf' },
    { ...base, kind: 'task', taskId: 'task', bucket: 'another-bucket' },
  ])('rejects missing, ambiguous, or arbitrary URL inputs: %j', input => {
    expect(() => parsePdfThumbnailSource(input)).toThrow();
  });

  it.each(['', ' ', '.', '..', 'path/file', 'path\\file', '\0hidden', 'line\nbreak', 'x'.repeat(501), '😀'.repeat(251)])(
    'rejects unsafe Firestore IDs: %j', attachmentId => {
      expect(() => parsePdfThumbnailSource({ ...base, kind: 'task', taskId: 'task', attachmentId })).toThrow();
    },
  );

  it('validates every locator segment before a document path can be built', () => {
    for (const field of ['projectId', 'taskId', 'commentId']) {
      expect(() => parsePdfThumbnailSource({ ...base, kind: 'comment', taskId: 'task', commentId: 'comment', [field]: '../other' })).toThrow();
    }
    expect(() => parsePdfThumbnailSource({ ...base, kind: 'reference', referenceId: '.' })).toThrow();
  });
});
