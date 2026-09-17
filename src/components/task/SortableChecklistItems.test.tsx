import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { CollisionDetection, DndContext, DragEndEvent, KeyboardCoordinateGetter } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { SortableChecklistItems } from './SortableChecklistItems';
const drag = vi.hoisted(() => ({ end: undefined as ((event: DragEndEvent) => void) | undefined,
  collision: undefined as CollisionDetection | undefined, keyboard: undefined as KeyboardCoordinateGetter | undefined }));
vi.mock('@dnd-kit/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return { ...actual, DndContext: (props: ComponentProps<typeof DndContext>) => {
    drag.end = props.onDragEnd;
    drag.collision = props.collisionDetection;
    drag.keyboard = props.sensors?.find(sensor => sensor.sensor === actual.KeyboardSensor)?.options.coordinateGetter;
    return <actual.DndContext {...props} />;
  } };
});
const drop = (target: string | null, source = 'b') => act(() => drag.end?.({ active: { id:source }, over: target ? {id:target} : null } as DragEndEvent));

const items = [
  { id: 'b', text: '箱', isChecked: true, order: 2 },
  { id: 'a', text: 'シール', isChecked: false, order: 1 },
  { id: 'c', text: 'テープ', isChecked: false, order: 3 },
];

describe('SortableChecklistItems', () => {
  it('edits a checked item by clicking its text and saves only its new name once', async () => {
    let finish!: () => void;
    const onRename = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const onToggle = vi.fn(), onDelete = vi.fn(), onMove = vi.fn();
    render(<SortableChecklistItems items={items} disabled={false} onMove={onMove} onToggle={onToggle} onDelete={onDelete} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: '箱を編集' }));
    const field = screen.getByRole('textbox', { name: 'チェック項目名' });
    expect(field).toHaveValue('箱');
    fireEvent.change(field, { target: { value: '  梱包用の箱  ' } });
    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledExactlyOnceWith('b', '梱包用の箱', '箱');
    expect(field).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: '箱の完了' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '箱の完了' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '箱を削除' })).toBeDisabled();
    await act(async () => finish());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onToggle).not.toHaveBeenCalled(); expect(onMove).not.toHaveBeenCalled(); expect(onDelete).not.toHaveBeenCalled();
  });

  it('cancels edits without saving and rejects blank text', () => {
    const onRename = vi.fn();
    render(<SortableChecklistItems items={items} disabled={false} onMove={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} onRename={onRename} />);
    fireEvent.click(screen.getByRole('button', { name: 'シールを編集' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: '項目名を保存' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'シールを編集' }));
    expect(screen.getByRole('textbox')).toHaveValue('シール');
    fireEvent.click(screen.getByRole('button', { name: '項目名を保存' }));
    expect(onRename).not.toHaveBeenCalled();
  });

  it('keeps failed edits for retry and retains the original text when new data arrives', async () => {
    const onRename = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const props = { disabled: false, onMove: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn(), onRename };
    const { rerender } = render(<SortableChecklistItems {...props} items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'シールを編集' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '宛名シール' } });
    rerender(<SortableChecklistItems {...props} items={items.map(item => item.id === 'a' ? { ...item, text: '共有で修正' } : item)} />);
    fireEvent.click(screen.getByRole('button', { name: '項目名を保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('入力は保持しています');
    expect(screen.getByRole('textbox')).toHaveValue('宛名シール');
    fireEvent.click(screen.getByRole('button', { name: '項目名を保存' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument());
    expect(onRename).toHaveBeenNthCalledWith(2, 'a', '宛名シール', 'シール');
  });

  it('puts incomplete items first, ignores cross-group drops, and separates actions', () => {
    const original = structuredClone(items);
    const onMove = vi.fn(), onToggle = vi.fn(), onDelete = vi.fn();
    render(<SortableChecklistItems items={items} disabled={false} onMove={onMove} onToggle={onToggle} onDelete={onDelete} onRename={vi.fn()} />);
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map(row => row.textContent)).toEqual(['シール', 'テープ', '箱']);
    expect(screen.queryByRole('button', { name: /を(上|下)へ$/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /をドラッグして並べ替え$/ })).toHaveLength(3);
    expect(onMove).not.toHaveBeenCalled();
    drop('c', 'a');
    expect(onMove).toHaveBeenCalledExactlyOnceWith('a', 'c');
    drop('a'); drop('c'); drop(null); drop('b'); drop('foreign'); drop('a', 'foreign');
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '箱の完了' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: '箱の完了' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('b');
    fireEvent.click(screen.getByRole('button', { name: '箱を削除' }));
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('b');
    expect(items).toEqual(original);
  });

  it('moves checked and unchecked items within their own manual order, never by rendering or checking', () => {
    const onMove = vi.fn(), onToggle = vi.fn();
    const props = { disabled: false, onMove, onToggle, onDelete: vi.fn(), onRename: vi.fn() };
    const withMore = [...items, { id: 'd', text: '梱包済み', isChecked: true, order: 4 }];
    const { rerender } = render(<SortableChecklistItems {...props} items={withMore} />);
    const rows = () => within(screen.getByRole('list')).getAllByRole('listitem').map(row => row.textContent);
    expect(rows()).toEqual(['シール', 'テープ', '箱', '梱包済み']);
    drop('d');
    expect(onMove).toHaveBeenCalledExactlyOnceWith('b', 'd');
    onMove.mockClear();
    fireEvent.click(screen.getByRole('checkbox', { name: 'シールの完了' }));
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('a');
    const checked = withMore.map(item => item.id === 'a' ? { ...item, isChecked: true } : item);
    rerender(<SortableChecklistItems {...props} items={checked} />);
    expect(rows()).toEqual(['テープ', 'シール', '箱', '梱包済み']);
    drop('c', 'a'); // The completion state changed after an earlier drag began.
    expect(onMove).not.toHaveBeenCalled();
    rerender(<SortableChecklistItems {...props} items={checked.map(item => item.id === 'b' ? { ...item, isChecked: false } : item)} />);
    expect(rows()).toEqual(['箱', 'テープ', 'シール', '梱包済み']);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('excludes the other completion group from pointer previews and keyboard destinations', () => {
    render(<SortableChecklistItems items={items} disabled={false} onMove={vi.fn()} onToggle={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    const rect = (top: number) => ({ top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20 });
    const rectangles = new Map([['a', rect(0)], ['c', rect(30)], ['b', rect(60)]]);
    const containers = items.map(item => ({ id: item.id, disabled: false, node: { current: document.createElement('div') },
      data: { current: { sortable: { containerId: 'checklist', items: ['a', 'c', 'b'], index: ['a', 'c', 'b'].indexOf(item.id) } } } }));
    // These focused fixtures provide the fields read by the coordinate helpers.
    const collisionArgs = { active: { id: 'a' }, collisionRect: rect(60), droppableRects: rectangles, droppableContainers: containers, pointerCoordinates: null };
    expect(drag.collision?.(collisionArgs as unknown as Parameters<CollisionDetection>[0])).toEqual([]);
    expect(drag.collision?.({ ...collisionArgs, collisionRect: rect(30) } as unknown as Parameters<CollisionDetection>[0])?.[0].id).toBe('c');
    const keyboardContext = { active: { id: 'c' }, collisionRect: rect(30), droppableRects: rectangles,
      droppableContainers: { getEnabled: () => containers, get: (id: string) => containers.find(item => item.id === id) }, scrollableAncestors: [] };
    expect(drag.keyboard?.(new KeyboardEvent('keydown', { code: 'ArrowDown' }), {
      active: 'c', currentCoordinates: { x: 0, y: 30 }, context: keyboardContext,
    } as unknown as Parameters<KeyboardCoordinateGetter>[1])).toBeUndefined();
    expect(drag.keyboard?.(new KeyboardEvent('keydown', { code: 'ArrowDown' }), {
      active: 'a', currentCoordinates: { x: 0, y: 0 }, context: { ...keyboardContext, active: { id: 'a' }, collisionRect: rect(0) },
    } as unknown as Parameters<KeyboardCoordinateGetter>[1])).toEqual({ x: 0, y: 30 });
  });

  it('disables drag handles, moves, checks and deletion during persistence', () => {
    const onMove = vi.fn();
    render(<SortableChecklistItems items={items} disabled onMove={onMove} onToggle={vi.fn()} onDelete={vi.fn()} onRename={vi.fn()} />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    drop('a');
    expect(onMove).not.toHaveBeenCalled();
  });

  it('renders an empty or single-item list without an available move', () => {
    const props = { disabled:false, onMove:vi.fn(), onToggle:vi.fn(), onDelete:vi.fn(), onRename:vi.fn() };
    const { rerender } = render(<SortableChecklistItems {...props} items={[]} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    rerender(<SortableChecklistItems {...props} items={[items[0]]} />);
    expect(screen.getAllByRole('button', { name: /をドラッグして並べ替え$/ })).toHaveLength(1);
    drop('b');
    expect(props.onMove).not.toHaveBeenCalled();
  });
});
