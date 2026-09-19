'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MousePointer2, Scan, Hand, X, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { captureAnnotation, describeElement } from '@/lib/ai/featureRequest/capture';
import { clampRect, type AnnotationRect, type ScreenAnnotation } from '@/lib/ai/featureRequest/annotations';

export function ScreenAnnotationPicker({ onCapture, onCancel }: { onCapture: (annotation: ScreenAnnotation) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'element' | 'region' | 'browse'>('element');
  const [selection, setSelection] = useState<{ rect: AnnotationRect; target: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const origin = useRef<{ x: number; y: number } | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const toolbar = useRef<HTMLDivElement>(null);
  useEffect(() => { mounted.current = true; toolbar.current?.focus(); return () => { mounted.current = false; }; }, []);
  const capture = async (chosen: NonNullable<typeof selection>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try {
      const annotation = await captureAnnotation(chosen.rect, chosen.target);
      if (mounted.current) onCapture(annotation); else URL.revokeObjectURL(annotation.preview);
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : '画像を作れませんでした。範囲を選び直してください。'); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && mode !== 'browse') {
        const buttons = Array.from(toolbar.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (buttons.length) { event.preventDefault(); buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus(); }
      }
      if ((event.key === 'Enter' || event.key === ' ') && (mode !== 'browse' || busyRef.current) && !toolbar.current?.contains(event.target as Node)) { event.preventDefault(); event.stopImmediatePropagation(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busyRef.current) onCancel(); }
    };
    const invalidate = () => { if (!busyRef.current) { setSelection(null); origin.current = null; } };
    const keepPickerFocus = (event: FocusEvent) => { if (toolbar.current?.contains(event.target as Node)) event.stopImmediatePropagation(); };
    document.addEventListener('focusin', keepPickerFocus, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', invalidate);
    document.addEventListener('scroll', invalidate, true);
    return () => { document.removeEventListener('focusin', keepPickerFocus, true); document.removeEventListener('keydown', keydown, true); window.removeEventListener('resize', invalidate); document.removeEventListener('scroll', invalidate, true); };
  }, [onCancel, mode]);
  const updateElement = (x: number, y: number) => {
    const hit = document.elementsFromPoint(x, y).find(item => !item.closest('[data-annotation-ui]') && !['BODY', 'HTML'].includes(item.tagName));
    if (!hit) return setSelection(null);
    const element = hit.closest('button, a, input, textarea, select, [role=button]') ?? hit;
    const box = element.getBoundingClientRect();
    setSelection({ rect: clampRect({ x: box.x, y: box.y, width: box.width, height: box.height }, window.innerWidth, window.innerHeight), target: describeElement(element) });
  };
  const region = (x: number, y: number) => {
    const start = origin.current;
    return start ? { rect: clampRect({ x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }, window.innerWidth, window.innerHeight), target: '選択した範囲' } : null;
  };
  return createPortal(<>
    {(mode !== 'browse' || busy) && <div data-annotation-ui data-html2canvas-ignore className="fixed inset-0 z-[2147483000] touch-none" style={{ cursor: busy ? 'wait' : 'crosshair', pointerEvents: 'auto' }}
      onPointerMove={event => { if (busy || event.buttons && !origin.current) return; if (mode === 'element') updateElement(event.clientX, event.clientY); else { const next = region(event.clientX, event.clientY); if (next) setSelection(next); } }}
      onPointerDown={event => { event.preventDefault(); event.stopPropagation(); if (busy) return; if (mode === 'element') updateElement(event.clientX, event.clientY); else { origin.current = { x: event.clientX, y: event.clientY }; setSelection(null); event.currentTarget.setPointerCapture(event.pointerId); } }}
      onPointerUp={event => { event.preventDefault(); event.stopPropagation(); if (busy) return; if (mode === 'region') { const next = region(event.clientX, event.clientY); origin.current = null; if (next) { setSelection(next); if (next.rect.width >= 8 && next.rect.height >= 8) void capture(next); } } else if (selection) void capture(selection); }}
      onPointerCancel={() => { origin.current = null; setSelection(null); }} onClick={event => { event.preventDefault(); event.stopPropagation(); }} />}
    {selection && <div data-annotation-ui data-html2canvas-ignore className="pointer-events-none fixed z-[2147483001] border-2 border-blue-600 bg-blue-500/5" style={{ left: selection.rect.x, top: selection.rect.y, width: selection.rect.width, height: selection.rect.height }} />}
    <div data-annotation-ui data-html2canvas-ignore ref={toolbar} style={{ pointerEvents: 'auto' }} onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} tabIndex={-1} role="region" aria-label="画面の注釈" aria-live="polite" className="fixed bottom-4 left-1/2 z-[2147483002] w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 space-y-2 rounded-xl border bg-background p-3 text-foreground shadow-xl">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="mr-1 text-sm">場所を選ぶ</strong>
        {([['element', '要素', MousePointer2], ['region', '範囲', Scan], ['browse', '画面を操作', Hand]] as const).map(([value, label, Icon]) => <Button key={value} size="sm" variant={mode === value ? 'secondary' : 'ghost'} aria-pressed={mode === value} disabled={busy} onClick={() => { setMode(value); setSelection(null); origin.current = null; setError(''); }}><Icon aria-hidden="true" />{label}</Button>)}
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}><X aria-hidden="true" />戻る</Button>
      </div>
      <p role="status" className="text-xs text-muted-foreground">{busy ? '画像を作成中…' : mode === 'element' ? '指した場所をクリック。範囲でも選べます。' : mode === 'region' ? 'ドラッグして囲んでください。' : '目的の画面を開いてから「要素」か「範囲」を選びます。'}</p>
      {mode === 'browse' && <Button size="sm" variant="outline" onClick={() => void capture({ rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, target: '画面全体' })} disabled={busy}><Camera aria-hidden="true" />画面全体を選ぶ</Button>}
      {error && <p role="alert" className="max-w-md text-sm text-destructive">{error}</p>}
    </div>
  </>, document.body);
}
