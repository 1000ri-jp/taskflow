import { afterEach, expect, it, vi } from 'vitest';
import { captureAnnotation } from './capture';
const fake = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('html2canvas-pro', () => ({ default: fake.render }));
afterEach(() => vi.restoreAllMocks());
it('resets the renderer transform so high-DPI annotation boxes match the selected CSS rectangle', async () => {
  const context = { setTransform: vi.fn(), strokeRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), strokeStyle: '', lineWidth: 0, fillStyle: '', font: '' };
  const width = window.innerWidth * 1.5;
  fake.render.mockResolvedValue({ width, getContext: () => context, toBlob: (callback: (blob: Blob) => void) => callback(new Blob(['png'], { type: 'image/png' })) });
  URL.createObjectURL = vi.fn(() => 'blob:annotation');
  const result = await captureAnnotation({ x: 100, y: 80, width: 200, height: 100 }, '履歴');
  expect(context.setTransform).toHaveBeenCalledWith(1.5, 0, 0, 1.5, 0, 0);
  expect(context.strokeRect).toHaveBeenCalledWith(101.5, 81.5, 197, 97);
  expect(result.rect).toEqual({ x: 100, y: 80, width: 200, height: 100 });
  expect(result.image.type).toBe('image/png');
  const options = fake.render.mock.calls[0][1];
  const toolbar = document.createElement('div'); toolbar.setAttribute('data-annotation-ui', ''); expect(options.ignoreElements(toolbar)).toBe(true);
  expect(options.allowTaint).toBe(false); expect(options.logging).toBe(false);
});
