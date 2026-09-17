import { expect, it } from 'vitest';
import { annotationRecord, clampRect, parseAnnotationReferences } from './annotations';
import { describeElement, maskCaptureDocument } from './capture';
export const reference = { id: '12345678-1234-1234-1234-123456789abc', pageUrl: 'https://taskflow.example/projects/p/board?task=t', pageTitle: '展示会', target: '未着手', comment: 'この列の表示を調整したい', rect: { x: 20, y: 30, width: 200, height: 100 }, viewport: { width: 1200, height: 800 }, capturedAt: '2026-09-13T10:00:00.000Z' };
it('keeps URL, target and comment with the corresponding image; clamps viewport edges', () => {
  expect(parseAnnotationReferences([reference])).toEqual([reference]);
  const record = annotationRecord([reference]);
  expect(record).toContain(reference.pageUrl); expect(record).toContain(reference.comment); expect(record).toContain(`画面注釈-${reference.id}.png`);
  expect(clampRect({ x: -10, y: 700, width: 50, height: 300 }, 1200, 800)).toEqual({ x: 0, y: 700, width: 40, height: 100 });
});
it('rejects duplicate IDs, executable links, credentials, missing comments, out-of-view bounds and extra payload', () => {
  for (const value of [[reference, reference], [{ ...reference, pageUrl: 'javascript:alert(1)' }], [{ ...reference, pageUrl: 'https://user:pass@example.com' }], [{ ...reference, comment: '' }], [{ ...reference, rect: { ...reference.rect, width: 20000 } }], [{ ...reference, image: 'raw' }], Array(6).fill(reference)]) expect(() => parseAnnotationReferences(value)).toThrow();
});
it('masks passwords and explicitly private content without including input values in target labels', () => {
  document.body.innerHTML = '<input type="password" value="secret-value"><div data-annotation-private>private-details</div><input aria-label="表示名" value="value-not-label">';
  expect(describeElement(document.querySelector('input')!)).toBe('非表示の項目');
  expect(describeElement(document.querySelector('input[aria-label]')!)).toBe('表示名');
  maskCaptureDocument(document);
  expect(document.querySelector('input')!.value).toBe('非表示'); expect(document.body.innerHTML).not.toContain('secret-value'); expect(document.body.textContent).not.toContain('private-details');
});
