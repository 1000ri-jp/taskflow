'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

const MIN_LIST_WIDTH = 96;
const DEFAULT_LIST_WIDTH = 176;
const MIN_CONTENT_WIDTH = 240;
const HANDLE_WIDTH = 8;

/** One list and one reading area, sized to the resizable panel rather than the page. */
export function HistoryPane({ label, actions, list, children }: {
  label: string; actions?: ReactNode; list: ReactNode; children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [preferredWidth, setPreferredWidth] = useState(DEFAULT_LIST_WIDTH);
  const [containerWidth, setContainerWidth] = useState(0);
  const listId = useId();
  const maxWidth = Math.max(MIN_LIST_WIDTH, containerWidth - MIN_CONTENT_WIDTH - HANDLE_WIDTH);
  const width = Math.min(preferredWidth, maxWidth);

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (next > 0) setContainerWidth(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const resize = (next: number) => {
    const available = container.current?.getBoundingClientRect().width ?? 0;
    if (available < 520) return;
    setPreferredWidth(Math.max(MIN_LIST_WIDTH, Math.min(Math.round(next), available - MIN_CONTENT_WIDTH - HANDLE_WIDTH)));
  };

  return <div ref={container} className="@container flex min-h-0 min-w-0 flex-1" style={{ '--history-width': `clamp(96px, ${preferredWidth}px, calc(100% - 248px))` } as CSSProperties}>
    <div className="flex min-h-0 min-w-0 flex-1 flex-col @[520px]:flex-row">
      <section id={listId} aria-label={label} className="flex max-h-44 w-full shrink-0 flex-col border-b @[520px]:max-h-none @[520px]:w-[var(--history-width)] @[520px]:border-b-0">
        <div className="flex min-h-10 shrink-0 items-center justify-between gap-1 border-b px-2 py-1">
          <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>{actions}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
      </section>
      <div role="separator" tabIndex={0} aria-label={`${label}と本文の幅を調整`} title="ドラッグまたは左右キーで幅を調整・ダブルクリックで元に戻す"
        aria-orientation="vertical" aria-controls={listId} aria-valuemin={MIN_LIST_WIDTH} aria-valuemax={maxWidth} aria-valuenow={width}
        className="relative hidden w-2 shrink-0 cursor-col-resize touch-none select-none bg-transparent outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-border hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring @[520px]:block"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          drag.current = { pointerId: event.pointerId, x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          resize(drag.current.width + event.clientX - drag.current.x);
        }}
        onPointerUp={event => {
          if (drag.current?.pointerId !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
        onDoubleClick={() => resize(DEFAULT_LIST_WIDTH)}
        onKeyDown={event => {
          const step = event.shiftKey ? 32 : 16;
          const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: MIN_LIST_WIDTH, End: maxWidth }[event.key];
          if (next === undefined) return;
          event.preventDefault(); event.stopPropagation(); resize(next);
        }} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  </div>;
}
