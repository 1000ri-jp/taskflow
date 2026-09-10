'use client';

import { useId, type ReactNode } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { sortedChecklistItems } from '@/lib/utils/checklist';
import type { ChecklistItem } from '@/types';

interface Props {
  items: ChecklistItem[];
  disabled: boolean;
  onMove: (itemId: string, targetId: string) => void;
  onToggle: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  renderAssignees?: (item: ChecklistItem) => ReactNode;
}

export function SortableChecklistItems({ items, disabled, onMove, onToggle, onDelete, renderAssignees }: Props) {
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sorted = sortedChecklistItems(items);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!disabled && over && active.id !== over.id && sorted.some(item => item.id === over.id)) {
      onMove(String(active.id), String(over.id));
    }
  };
  return <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}
    accessibility={{ screenReaderInstructions: { draggable: 'スペースでつかみ、上下矢印で移動、スペースで確定、Escapeで取り消します。' } }}>
    <SortableContext items={sorted.map(item => item.id)} strategy={verticalListSortingStrategy}>
      <div role="list" aria-label="チェックリストの項目">
        {sorted.map(item => <SortableItem key={item.id} item={item} disabled={disabled}
          onToggle={onToggle} onDelete={onDelete} renderAssignees={renderAssignees} />)}
      </div>
    </SortableContext>
  </DndContext>;
}

function SortableItem({ item, disabled, onToggle, onDelete, renderAssignees }: Omit<Props, 'items' | 'onMove'> & { item: ChecklistItem }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return <div ref={setNodeRef} role="listitem" style={{ transform: CSS.Transform.toString(transform), transition }}
    className={cn('group relative flex items-center gap-2 rounded py-2', isDragging && 'z-10 bg-muted shadow-sm')}>
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} disabled={disabled}
      aria-label={`${item.text}をドラッグして並べ替え`} title="ドラッグして並べ替え"
      className="flex h-7 w-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 cursor-grab active:cursor-grabbing">
      <GripVertical className="h-4 w-4" />
    </button>
    <Checkbox checked={item.isChecked} disabled={disabled} aria-label={`${item.text}の完了`} onCheckedChange={() => onToggle(item.id)} />
    <div className="min-w-0 flex-1">
      <span className={cn('block break-words text-sm', item.isChecked && 'text-muted-foreground line-through')}>{item.text}</span>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {renderAssignees?.(item)}
      <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        disabled={disabled} aria-label={`${item.text}を削除`} onClick={() => onDelete(item.id)}><X className="h-3 w-3" /></Button>
    </div>
  </div>;
}
