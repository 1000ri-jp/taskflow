'use client';

import type { ReactNode } from 'react';
import { BOARD_SORT_OPTIONS, isBoardSort, type BoardSort } from '@/lib/board/sort';
import { useBoardDisplayStore, type BoardDisplaySettings } from '@/stores/boardDisplayStore';
import { Button } from '@/components/ui/button';

export const COLUMN_DISPLAY_FIELDS: [keyof BoardDisplaySettings, string][] = [['showListName', 'リスト名'], ['showAssignees', '担当者'], ['showPriority', '優先度'], ['showTags', 'ラベル・タグ']];
export function ColumnDisplayOptions({ name, sort, display, onSort, onDisplay, onReset, error, children }: {
  name: string; sort: BoardSort; display: Partial<BoardDisplaySettings>;
  onSort: (sort: BoardSort) => void;
  onDisplay: (display: Partial<BoardDisplaySettings>) => void;
  onReset: () => void; error: boolean; children?: ReactNode;
}) {
  const shared = useBoardDisplayStore(state => state.settings);
  return <>
    <p className="text-sm font-bold">{name}の表示</p>
    <label className="flex items-center justify-between gap-2 text-sm">並び順<select aria-label={`${name}の並び順`} className="min-w-0 rounded border bg-white p-1" value={sort} onChange={event => { if (isBoardSort(event.target.value)) onSort(event.target.value); }}>{BOARD_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    {children}
    <fieldset className="space-y-2 border-t pt-2"><legend className="text-xs text-muted-foreground">カードに表示</legend>{COLUMN_DISPLAY_FIELDS.map(([field, label]) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={display[field] ?? shared[field]} onChange={event => onDisplay({ ...display, [field]: event.target.checked })} />{label}</label>)}</fieldset>
    <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">このブラウザ・自分用</span><Button type="button" size="sm" variant="ghost" onClick={onReset}>標準に戻す</Button></div>
    {error && <p role="alert" className="text-xs text-destructive">表示設定を保存できません。</p>}
  </>;
}
