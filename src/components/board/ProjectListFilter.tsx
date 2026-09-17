'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { List } from '@/types';

export function ProjectListFilter({ lists }: { lists: List[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const listId = searchParams.get('list') ?? '';
  return <label className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
    <select aria-label="リストで絞り込む" value={listId} className="h-8 min-w-0 max-w-64 rounded-md border bg-background px-2 text-sm text-foreground" onChange={event => {
      const next = new URLSearchParams(searchParams.toString());
      if (event.target.value) next.set('list', event.target.value); else next.delete('list');
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
    }}>
      <option value="">すべてのリスト</option>
      {listId && !lists.some(list => list.id === listId) && <option value={listId}>選択したリストを表示できません</option>}
      {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
    </select>
  </label>;
}
