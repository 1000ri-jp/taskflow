"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { GripHorizontal } from 'lucide-react';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';

type Position = { x: number; y: number };

/** Mount while open so each new dialog starts in the center. */
export function MovableDialogContent({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; origin: Position; left: number; top: number } | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const fit = useCallback((next: Position) => {
    const rect = content.current?.getBoundingClientRect();
    if (!rect) return next;
    return { x: Math.max(8, Math.min(next.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(next.y, window.innerHeight - rect.height - 8)) };
  }, []);
  useEffect(() => {
    if (!position || !content.current) return;
    const clamp = () => setPosition(previous => {
      if (!previous) return previous;
      const next = fit(previous);
      return next.x === previous.x && next.y === previous.y ? previous : next;
    });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(clamp);
    observer?.observe(content.current);
    window.addEventListener('resize', clamp);
    return () => { observer?.disconnect(); window.removeEventListener('resize', clamp); };
  }, [position, fit]);
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <DialogContent ref={content} className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-3xl" style={position ? { left: position.x, top: position.y, translate: 'none' } : undefined}>
    <DialogHeader className="shrink-0 cursor-move touch-none select-none pr-6"
      onPointerDown={event => {
        if (event.button !== 0 || !content.current) return;
        const rect = content.current.getBoundingClientRect();
        drag.current = { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, left: rect.left, top: rect.top };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        setPosition(fit({ x: start.left + event.clientX - start.origin.x, y: start.top + event.clientY - start.origin.y }));
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="画面を移動" title="ドラッグまたは矢印キーで移動・Homeで中央に戻す" className="shrink-0 cursor-move rounded p-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
          onKeyDown={event => {
            if (event.key === 'Home') { event.preventDefault(); setPosition(null); return; }
            const directions: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
            const direction = directions[event.key];
            const rect = content.current?.getBoundingClientRect();
            if (!direction || !rect) return;
            event.preventDefault();
            const step = event.shiftKey ? 60 : 20;
            setPosition(fit({ x: rect.left + step * direction.x, y: rect.top + step * direction.y }));
          }}><GripHorizontal className="size-4" aria-hidden="true" /></button>
        <DialogTitle>{title}</DialogTitle>
      </div>
      <DialogDescription>{description}</DialogDescription>
    </DialogHeader>
    <div className="min-h-0 overflow-y-auto">{children}</div>
  </DialogContent>;
}
