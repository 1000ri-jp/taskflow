'use client';

import { checklistItems } from '@/lib/dashboard/meeting-checklists';
import type { MeetingProposal } from '@/lib/dashboard/meeting-proposals';
import { useMeetingChecklistStore } from '@/stores/meetingChecklistStore';
import { Input } from '@/components/ui/input';

export function MeetingChecklistItems({ proposal, onDueDateChange }: { proposal: MeetingProposal; onDueDateChange: (date: string) => void }) {
  const { items,setItem } = useMeetingChecklistStore();
  const entries = checklistItems(proposal);
  return <div className="space-y-2 rounded-lg border bg-white p-2" aria-label={proposal.id + 'の作業チェック（テスト）'}>
    {entries.map(entry => {
      const saved = items[entry.key];
      const dueDate = proposal.id === 'EX-9' ? saved?.dueDate ?? proposal.dueDate : proposal.dueDate;
      const saveDueDate = (value: string) => {
        if (proposal.id === 'EX-9') {
          const current = useMeetingChecklistStore.getState().items[entry.key];
          if (value !== (current?.dueDate ?? proposal.dueDate)) {
            setItem(entry.key,{checked:current?.checked ?? false,dueDate:value});
          }
        } else if (value !== proposal.dueDate) {
          onDueDateChange(value);
        }
      };
      return <div key={entry.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-emerald-600" checked={saved?.checked ?? false} aria-label={entry.label + 'を完了（テスト）'} onChange={event => setItem(entry.key,{...saved,checked:event.target.checked})}/>
          <span className={saved?.checked ? 'text-muted-foreground line-through' : ''}>{proposal.id === 'EX-9' ? entry.label : '完了チェック（テスト）'}</span>
        </label>
        <label className="flex items-center gap-2"><span>期限</span><Input type="date" className="h-7 w-36 px-2 text-xs" aria-label={entry.label + 'の子タスク期限'} value={dueDate} onInput={event => saveDueDate(event.currentTarget.value)} onChange={event => saveDueDate(event.target.value)}/></label>
        {saved && <button type="button" className="text-[11px] text-muted-foreground underline" aria-label={entry.label + 'のテスト入力を解除'} onClick={()=>setItem(entry.key)}>元に戻す</button>}
      </div>;
    })}
    {!entries.length && <p className="text-xs text-amber-800">担当者を指定すると、各人の購入チェックが表示されます。</p>}
  </div>;
}
