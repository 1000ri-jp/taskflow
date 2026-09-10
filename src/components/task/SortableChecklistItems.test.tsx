import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { DndContext, DragEndEvent } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { SortableChecklistItems } from './SortableChecklistItems';
const drag = vi.hoisted(() => ({ end: undefined as ((event: DragEndEvent) => void) | undefined }));
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return { ...actual, DndContext: (props: ComponentProps<typeof DndContext>) => {
    drag.end = props.onDragEnd;
    return <actual.DndContext {...props} />;
  } };
});
const drop = (target: string | null) => act(() => drag.end?.({ active: { id:'b' }, over: target ? {id:target} : null } as DragEndEvent));

const items = [
  { id: 'b', text: '箱', isChecked: true, order: 2 },
  { id: 'a', text: 'シール', isChecked: false, order: 1 },
  { id: 'c', text: 'テープ', isChecked: false, order: 3 },
];

describe('SortableChecklistItems', () => {
  it('sorts without mutating, disables boundary moves, and separates actions', () => {
    const original = structuredClone(items);
    const onMove = vi.fn(), onToggle = vi.fn(), onDelete = vi.fn();
    render(<SortableChecklistItems items={items} disabled={false} onMove={onMove} onToggle={onToggle} onDelete={onDelete} />);
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map(row => row.textContent)).toEqual(['シール', '箱', 'テープ']);
    expect(screen.queryByRole('button', { name: /を(上|下)へ$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /をドラッグして並べ替え$/ })).toHaveLength(3);
    drop('a');
    expect(onMove).toHaveBeenLastCalledWith('b', 'a');
    drop('c');
    expect(onMove).toHaveBeenLastCalledWith('b', 'c');
    drop(null); drop('b'); drop('foreign');
    expect(onMove).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '箱の完了' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '箱の完了' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('b');
    fireEvent.click(screen.getByRole('button', { name: '箱を削除' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('b');
    expect(items).toEqual(original);
  });

  it('disables drag handles, moves, checks and deletion during persistence', () => {
    const onMove = vi.fn();
    render(<SortableChecklistItems items={items} disabled onMove={onMove} onToggle={vi.fn()} onDelete={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    drop('a');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('renders an empty or single-item list without an available move', () => {
    const props = { disabled:false, onMove:vi.fn(), onToggle:vi.fn(), onDelete:vi.fn() };
    const { rerender } = render(<SortableChecklistItems {...props} items={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<SortableChecklistItems {...props} items={[items[0]]} />);
    expect(screen.getAllByRole('button', { name: /をドラッグして並べ替え$/ })).toHaveLength(1);
    drop('b');
    expect(props.onMove).not.toHaveBeenCalled();
  });
});
