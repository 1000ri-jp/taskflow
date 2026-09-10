export interface PanelBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PanelResizeCorner = 'nw' | 'se';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function fitPanelBounds(start: PanelBounds, viewport: { width: number; height: number }): PanelBounds {
  const width = Math.min(start.width, Math.max(1, viewport.width));
  const height = Math.min(start.height, Math.max(1, viewport.height));
  return {
    x: clamp(start.x, 0, Math.max(0, viewport.width - width)),
    y: clamp(start.y, 0, Math.max(0, viewport.height - height)),
    width,
    height,
  };
}

export function resizePanelBounds(
  start: PanelBounds,
  corner: PanelResizeCorner,
  delta: { x: number; y: number },
  viewport: { width: number; height: number }
): PanelBounds {
  const viewportWidth = Math.max(1, viewport.width);
  const viewportHeight = Math.max(1, viewport.height);

  if (corner === 'nw') {
    // Keep the opposite corner still while moving the top and left edges.
    const right = clamp(start.x + start.width, 1, viewportWidth);
    const bottom = clamp(start.y + start.height, 1, viewportHeight);
    const x = clamp(start.x + delta.x, 0, right - Math.min(320, right));
    const y = clamp(start.y + delta.y, 0, bottom - Math.min(360, bottom));
    return { x, y, width: right - x, height: bottom - y };
  }

  const x = clamp(start.x, 0, viewportWidth - 1);
  const y = clamp(start.y, 0, viewportHeight - 1);
  const maxWidth = viewportWidth - x;
  const maxHeight = viewportHeight - y;
  return {
    x,
    y,
    width: clamp(start.width + delta.x, Math.min(320, maxWidth), maxWidth),
    height: clamp(start.height + delta.y, Math.min(360, maxHeight), maxHeight),
  };
}
