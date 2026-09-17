import { annotationFileName, clampRect, MAX_ANNOTATION_BYTES, type AnnotationRect, type ScreenAnnotation } from './annotations';

export function describeElement(element: Element): string {
  if (element.closest('[data-annotation-private], input[type="password"]')) return '非表示の項目';
  return (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.tagName).replace(/\s+/g, ' ').trim().slice(0, 200);
}
export function maskCaptureDocument(doc: Document) {
  doc.querySelectorAll('input[type="password"], [data-annotation-private]').forEach(element => {
    if (element.tagName === 'INPUT') { const input = element as HTMLInputElement; input.type = 'text'; input.value = '非表示'; input.setAttribute('value', '非表示'); }
    else { element.textContent = '非表示'; }
  });
}
export async function captureAnnotation(rect: AnnotationRect, target: string): Promise<ScreenAnnotation> {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const bounded = clampRect(rect, viewport.width, viewport.height);
  if (bounded.width < 8 || bounded.height < 8) throw new Error('もう少し広い範囲を選んでください。');
  const pageUrl = window.location.href;
  const pageTitle = document.title.slice(0, 200);
  const capturedAt = new Date().toISOString();
  const { default: html2canvas } = await import('html2canvas-pro');
  const canvas = await html2canvas(document.body, {
    width: viewport.width, height: viewport.height, x: window.scrollX, y: window.scrollY,
    windowWidth: viewport.width, windowHeight: viewport.height,
    scrollX: window.scrollX, scrollY: window.scrollY,
    scale: Math.min(1.5, 2400 / Math.max(viewport.width, viewport.height)),
    signal: AbortSignal.timeout(20000),
    useCORS: true, allowTaint: false, logging: false, imageTimeout: 5000,
    ignoreElements: element => element.hasAttribute('data-annotation-ui') || element.tagName === 'NEXTJS-PORTAL',
    onclone: maskCaptureDocument,
  });
  if (pageUrl !== window.location.href || viewport.width !== window.innerWidth || viewport.height !== window.innerHeight) throw new Error('画面が変わりました。もう一度選んでください。');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を作成できませんでした。');
  const scale = canvas.width / viewport.width;
  context.setTransform(scale, 0, 0, scale, 0, 0); context.strokeStyle = '#2563eb'; context.lineWidth = 3;
  context.strokeRect(bounded.x + 1.5, bounded.y + 1.5, bounded.width - 3, bounded.height - 3);
  const markerX = Math.max(0, Math.min(viewport.width - 52, bounded.x));
  const markerY = Math.max(0, bounded.y - 25);
  context.fillStyle = '#2563eb'; context.fillRect(markerX, markerY, 52, 25);
  context.fillStyle = '#ffffff'; context.font = 'bold 14px sans-serif'; context.fillText('注釈', markerX + 12, markerY + 18);
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob || blob.size > MAX_ANNOTATION_BYTES) throw new Error('画像が大きすぎます。画面を小さくして撮り直してください。');
  const id = crypto.randomUUID();
  const image = new File([blob], annotationFileName(id), { type: 'image/png' });
  return { id, pageUrl, pageTitle, target, comment: '', rect: bounded, viewport, capturedAt, image, preview: URL.createObjectURL(image) };
}
