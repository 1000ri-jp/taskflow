import { describe, expect, it } from 'vitest';
import { fitPanelBounds, resizePanelBounds } from './panelResize';

const start = { x: 400, y: 300, width: 420, height: 400 };
const viewport = { width: 1200, height: 900 };

describe('fitPanelBounds', () => {
  it('keeps an on-screen panel unchanged', () => {
    expect(fitPanelBounds(start, viewport)).toEqual(start);
  });

  it('brings a saved off-screen position back into a smaller viewport', () => {
    expect(fitPanelBounds({ x: 6, y: 831, width: 1244, height: 360 }, { width: 1280, height: 720 }))
      .toEqual({ x: 6, y: 360, width: 1244, height: 360 });
  });

  it('fits an oversized panel inside a small viewport', () => {
    expect(fitPanelBounds(start, { width: 280, height: 300 }))
      .toEqual({ x: 0, y: 0, width: 280, height: 300 });
  });
});

describe('resizePanelBounds', () => {
  it('expands from the upper-left without moving the bottom-right', () => {
    const next = resizePanelBounds(start, 'nw', { x: -80, y: -60 }, viewport);
    expect(next).toEqual({ x: 320, y: 240, width: 500, height: 460 });
    expect(next.x + next.width).toBe(start.x + start.width);
    expect(next.y + next.height).toBe(start.y + start.height);
  });

  it('stops upper-left shrinking at the minimum size', () => {
    expect(resizePanelBounds(start, 'nw', { x: 1000, y: 1000 }, viewport))
      .toEqual({ x: 500, y: 340, width: 320, height: 360 });
  });

  it('keeps the upper-left inside the screen', () => {
    expect(resizePanelBounds(start, 'nw', { x: -1000, y: -1000 }, viewport))
      .toEqual({ x: 0, y: 0, width: 820, height: 700 });
  });

  it('keeps the top-left still when resizing from the bottom-right', () => {
    expect(resizePanelBounds(start, 'se', { x: 80, y: 60 }, viewport))
      .toEqual({ x: 400, y: 300, width: 500, height: 460 });
  });

  it('limits bottom-right expansion to the screen', () => {
    expect(resizePanelBounds(start, 'se', { x: 1000, y: 1000 }, viewport))
      .toEqual({ x: 400, y: 300, width: 800, height: 600 });
  });

  it('limits bottom-right shrinking to the minimum size', () => {
    expect(resizePanelBounds(start, 'se', { x: -1000, y: -1000 }, viewport))
      .toEqual({ x: 400, y: 300, width: 320, height: 360 });
  });

  it.each(['nw', 'se'] as const)('fits a screen smaller than the normal minimum (%s)', (corner) => {
    const next = resizePanelBounds(
      { x: 0, y: 0, width: 280, height: 300 }, corner,
      { x: 0, y: 0 }, { width: 280, height: 300 }
    );
    expect(next).toEqual({ x: 0, y: 0, width: 280, height: 300 });
  });
});
