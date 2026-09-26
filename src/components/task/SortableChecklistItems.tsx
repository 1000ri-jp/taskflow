'use client';

import { useId, useRef, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, Pencil, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { ChecklistItemDueDate } from './ChecklistItemDueDate';
import type { ChecklistDeadline } from '@/lib/utils/checklist-item';
import { sortedChecklistItems } from '@/lib/utils/checklist';
import type { ChecklistItem } from '@/types';

interface Props {
  items: ChecklistItem[];
  disabled: boolean;
  onMove: (itemId: string, targetId: string) => void;
  onToggle: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  onDeadline?: (itemId: string, value: ChecklistDeadline) => Promise<void>;
  onRename: (itemId: string, text: string, expectedText: string) => Promise<void>;
}

export function SortableChecklistItems({ items, disabled, onMove, onToggle, onDelete, onRename, onDeadline }: Props) {
  const id = useId();
  const sorted = sortedChecklistItems(items);
  const groupIds = (activeId: string) => {
    const active = items.find(item => item.id === activeId);
    return new Set(items.filter(item => active && item.isChecked === active.isChecked).map(item => item.id));
  };
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    const ids = groupIds(String(args.active));
    return sortableKeyboardCoordinates(event, { ...args, context: { ...args.context,
      droppableRects: new Map([...args.context.droppableRects].filter(([itemId]) => ids.has(String(itemId)))),
    } });
  };
  const collisions: CollisionDetection = args => {
    const ids = groupIds(String(args.active.id));
    const targets = closestCenter(args);
    // Crossing the completion boundary must not preview or save a move.
    return targets[0] && ids.has(String(targets[0].id)) ? targets.filter(target => ids.has(String(target.id))) : [];
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!disabled && over && active.id !== over.id && groupIds(String(active.id)).has(String(over.id))) {
      onMove(String(active.id), String(over.id));
    }
  };
  return <DndContext id={id} sensors={sensors} collisionDetection={collisions} onDragEnd={handleDragEnd}
    accessibility={{ screenReaderInstructions: { draggable: 'スペースでつかみ、上下矢印で移動、スペースで確定、Escapeで取り消します。' } }}>
    <SortableContext items={sorted.map(item => item.id)} strategy={verticalListSortingStrategy}>
      <div role="list" aria-label="チェックリストの項目">
        {sorted.map(item => <SortableItem key={item.id} item={item} disabled={disabled}
          onToggle={onToggle} onDelete={onDelete} onRename={onRename} onDeadline={onDeadline} />)}
      </div>
    </SortableContext>
  </DndContext>;
}

function SortableItem({ item, disabled, onToggle, onDelete, onRename, onDeadline }: Omit<Props, 'items' | 'onMove'> & { item: ChecklistItem }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [original, setOriginal] = useState(item.text);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const save = async () => {
    if (pending.current || disabled || !draft.trim()) return;
    if (draft.trim() === original) { setEditing(false); return; }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await onRename(item.id, draft.trim(), original);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith('項目名が変更されています')
        ? cause.message : '項目名を保存できませんでした。入力は保持しています。もう一度お試しください。');
    } finally { pending.current = false; setSaving(false); }
  };
  const locked = disabled || saving;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: locked || editing });
  return <div ref={setNodeRef} role="listitem" style={{ transform: CSS.Transform.toString(transform), transition }}
    className={cn('group relative flex flex-wrap items-center gap-2 rounded py-0.5 sm:flex-nowrap', isDragging && 'z-10 bg-muted shadow-sm')}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={locked || editing}
      aria-label={`${item.text}をドラッグして並べ替え`} title="ドラッグして並べ替え"
      className="flex h-6 w-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 cursor-grab active:cursor-grabbing">
      <GripVertical className="h-4 w-4" />
    </button>
    <Checkbox checked={item.isChecked} disabled={locked} aria-label={`${item.text}の完了`} onCheckedChange={() => onToggle(item.id)} />
    <div className="min-w-0 flex-1">
      {editing ? <div className="space-y-1">
        <div className="flex items-center gap-1">
          <Input autoFocus data-checklist-item-editor aria-label="チェック項目名" value={draft} disabled={locked} className="h-8 min-w-0 flex-1 text-sm"
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') { event.preventDefault(); void save(); }
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) setEditing(false); }
            }} />
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="項目名を保存" disabled={locked || !draft.trim()} onClick={() => void save()}><Check className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="項目名の編集をキャンセル" disabled={saving} onClick={() => setEditing(false)}><X className="h-4 w-4" /></Button>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      </div> : <button type="button" disabled={disabled} aria-label={`${item.text}を編集`} title="項目名を編集"
        className="flex w-full min-w-0 items-start gap-1.5 rounded text-left hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => { setDraft(item.text); setOriginal(item.text); setError(''); setEditing(true); }}>
        <span className={cn('min-w-0 break-words text-sm leading-5', item.isChecked && 'text-muted-foreground line-through')}>{item.text}</span>
        <Pencil aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 text-muted-foreground opacity-50 group-hover:opacity-100" />
      </button>}
    </div>
    {onDeadline && <ChecklistItemDueDate item={item} disabled={locked || editing}
      onSave={dueDate => onDeadline(item.id, { dueDate, dueTime: null, deadlinePolicy: null })}
      onSaveDeadline={value => onDeadline(item.id, value)} />}
    <div className="shrink-0">
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        disabled={locked} aria-label={`${item.text}を削除`} onClick={() => onDelete(item.id)}><Trash2 className="h-3 w-3" /></Button>
    </div>
  </div>;
}
