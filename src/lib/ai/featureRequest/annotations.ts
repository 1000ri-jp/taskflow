export interface AnnotationRect { x: number; y: number; width: number; height: number }
export interface AnnotationReference {
  id: string;
  pageUrl: string;
  pageTitle: string;
  target: string;
  comment: string;
  rect: AnnotationRect;
  viewport: { width: number; height: number };
  capturedAt: string;
}
export interface ScreenAnnotation extends AnnotationReference { image: File; preview: string }
export const MAX_ANNOTATIONS = 5;
export const MAX_ANNOTATION_BYTES = 5 * 1024 * 1024;
export const annotationFileName = (id: string) => `画面注釈-${id}.png`;
export function clampRect(rect: AnnotationRect, width: number, height: number): AnnotationRect {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  return { x, y, width: Math.max(0, Math.min(width, rect.x + rect.width) - x), height: Math.max(0, Math.min(height, rect.y + rect.height) - y) };
}
export function annotationReferences(items: ScreenAnnotation[]): AnnotationReference[] {
  return items.map(({ id, pageUrl, pageTitle, target, comment, rect, viewport, capturedAt }) => ({ id, pageUrl, pageTitle, target, comment, rect, viewport, capturedAt }));
}
export function parseAnnotationReferences(value: unknown): AnnotationReference[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ANNOTATIONS) throw new Error('画面注釈を確認してください。');
  const ids = new Set<string>();
  return value.map(item => {
    const validText = (text: unknown, max: number) => typeof text === 'string' && text.length <= max;
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['id', 'pageUrl', 'pageTitle', 'target', 'comment', 'rect', 'viewport', 'capturedAt'].includes(key)) || typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id) || !validText(item.pageUrl, 2048) || !validText(item.pageTitle, 200) || !validText(item.target, 200) || !validText(item.comment, 1000) || !item.comment.trim() || !validText(item.capturedAt, 40) || !Number.isFinite(Date.parse(item.capturedAt))) throw new Error('画面注釈を確認してください。');
    const url = new URL(item.pageUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('画面URLを確認してください。');
    const { rect, viewport } = item;
    if (!rect || !viewport || ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 20000) || rect.width < 8 || rect.height < 8 || rect.x + rect.width > viewport.width || rect.y + rect.height > viewport.height) throw new Error('選択範囲を確認してください。');
    ids.add(item.id);
    return { id: item.id, pageUrl: item.pageUrl, pageTitle: item.pageTitle, target: item.target, comment: item.comment, capturedAt: item.capturedAt, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, viewport: { width: viewport.width, height: viewport.height } };
  });
}
export function annotationRecord(items: AnnotationReference[]): string {
  return items.map((item, index) => `画面注釈 ${index + 1}\nページ：${item.pageTitle}\nURL：${item.pageUrl}\n対象：${item.target}\nコメント：${item.comment}\n画像：${annotationFileName(item.id)}\n範囲：x=${item.rect.x}, y=${item.rect.y}, 幅=${item.rect.width}, 高さ=${item.rect.height}（画面 ${item.viewport.width}×${item.viewport.height}）\n撮影：${item.capturedAt}`).join('\n\n');
}
