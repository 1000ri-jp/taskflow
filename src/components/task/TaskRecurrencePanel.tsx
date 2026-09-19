'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Repeat2 } from 'lucide-react';
import type { List, Task } from '@/types';
import { RECURRENCE_UNITS, civilDate, nextRecurrence, type RecurrenceSettings } from '@/lib/task/recurrence';
import { recurrenceRequest } from '@/lib/task/recurrenceClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function TaskRecurrencePanel({ task, lists, defaultOpen = false }: { task: Task; lists: List[]; defaultOpen?: boolean }) {
  const contentId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!defaultOpen) return;
    const frame = requestAnimationFrame(() => sectionRef.current?.scrollIntoView?.({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [defaultOpen]);
  const initial = (): RecurrenceSettings => ({ seriesId:crypto.randomUUID(), unit:task.recurrence?.unit ?? 'month', interval:task.recurrence?.interval ?? 1,
    anchorDate:civilDate(task.dueDate) ?? civilDate(new Date())!, endDate:task.recurrence?.endDate ?? null, listId:task.recurrence?.listId ?? (lists.find(l=>l.id===task.listId && !l.autoCompleteOnEnter) ?? lists.find(l=>!l.autoCompleteOnEnter))?.id ?? '' });
  const [open,setOpen]=useState(defaultOpen), [editing,setEditing]=useState(!task.recurrence), [draft,setDraft]=useState<RecurrenceSettings>(initial);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState('');
  const guard=useRef(false);
  const version=useRef(task.updatedAt?.toISOString() ?? '');
  let preview: ReturnType<typeof nextRecurrence> = null; let invalidPreview = false;
  try { preview=nextRecurrence({...draft,occurrence:0}); } catch { invalidPreview = true; }
  let created: ReturnType<typeof nextRecurrence> = null;
  try { if(task.recurrence) created=nextRecurrence(task.recurrence); } catch { /* Old malformed settings remain editable. */ }
  const save = async (remove=false) => {
    if(guard.current)return;guard.current=true;setBusy(true);setError('');setSaved('');
    try { await recurrenceRequest(task.projectId,task.id,{action:'configure',expectedVersion:version.current,settings:remove?null:draft}); setSaved(remove?'繰り返しを解除しました。':'繰り返しを保存しました。'); }
    catch(e){setError(e instanceof Error?e.message:'保存できませんでした。');}
    finally{guard.current=false;setBusy(false);}
  };
  if(task.taskKind==='review_request' || task.isArchived || task.isAbandoned) return null;
  return <section ref={sectionRef} className="mt-2 border-t pt-2">
    <Button type="button" size="sm" variant="ghost" className="h-auto min-h-9 w-full justify-start gap-2 px-1" aria-expanded={open} aria-controls={contentId} disabled={busy}
      onClick={()=>{if(!open){setEditing(!task.recurrence);setDraft(initial());version.current=task.updatedAt?.toISOString()??'';setError('');setSaved('');}setOpen(!open);}}>
      <Repeat2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span>繰り返し</span>
      {task.recurrence && <span className="text-xs text-muted-foreground">{task.recurrence.interval}{RECURRENCE_UNITS[task.recurrence.unit]}ごと</span>}
      <ChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
    </Button>
    {open && <div id={contentId} role="group" className="space-y-3 pt-2" aria-label="繰り返しの設定">
      <p className="text-xs text-muted-foreground">完了すると、次回分を1件作成します。タスク名・説明・担当者とチェックリストを引き継ぎ、チェックは未完了に戻します。</p>
      {task.isCompleted ? <p className="text-sm">{created ? <a className="underline" href={`/projects/${task.projectId}/board?task=${created.id}`}>次回のタスクを開く（期限 {created.dueDate}）</a> : (task.recurrence ? '終了日を迎えたため、次回分は作成されません。' : '設定は未完了のタスクで行えます。')}</p> : task.recurrence && !editing ? <div className="space-y-3 text-sm"><p>{task.recurrence.interval}{RECURRENCE_UNITS[task.recurrence.unit]}ごと・{created ? `次回の期限：${created.dueDate}` : '次回分なし（終了日）'}</p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={()=>void save(true)}>繰り返しを解除</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={()=>{setEditing(true);setSaved('');}}>設定を変更</Button></div></div> : <form className="space-y-3" onSubmit={e=>{e.preventDefault();void save();}}>
        <fieldset disabled={busy || !!saved} className="space-y-3 min-w-0">
          <div className="flex items-center gap-2"><Input type="number" min={1} max={365} required aria-label="繰り返しの間隔" className="w-20" value={draft.interval} onChange={e=>setDraft({...draft,interval:Number(e.target.value)})}/><select aria-label="繰り返しの単位" className="h-9 rounded border px-2 text-sm" value={draft.unit} onChange={e=>setDraft({...draft,unit:e.target.value as RecurrenceSettings['unit']})}>{Object.entries(RECURRENCE_UNITS).map(([unit,label])=><option key={unit} value={unit}>{label}</option>)}</select><span className="text-sm">ごと</span></div>
          <label className="block text-sm">基準日（今回分）<Input type="date" required value={draft.anchorDate} onChange={e=>setDraft({...draft,anchorDate:e.target.value})}/></label>
          <label className="block text-sm">終了日（任意）<Input type="date" min={draft.anchorDate} value={draft.endDate??''} onChange={e=>setDraft({...draft,endDate:e.target.value||null})}/></label>
          <label className="block text-sm">次回のリスト<select required className="mt-1 h-9 w-full rounded border px-2" value={draft.listId} onChange={e=>setDraft({...draft,listId:e.target.value})}><option value="" disabled>リストを選択</option>{lists.filter(l=>!l.autoCompleteOnEnter).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <p className="rounded bg-muted p-2 text-sm">{preview ? `次回の期限：${preview.dueDate}` : invalidPreview ? '日付と間隔を入力してください。' : 'この終了日では次回分は作成されません。'}</p>
          <p className="text-xs text-muted-foreground">月末に同じ日がない月は末日になります。サブタスクは個別に設定できます。コメント・添付・依存関係は今回分に残します。</p>
          <div className="flex items-center justify-end gap-2">{task.recurrence&&<Button type="button" variant="ghost" size="sm" onClick={()=>void save(true)}>繰り返しを解除</Button>}<Button type="submit" size="sm">{busy?'保存中…':'保存'}</Button></div>
        </fieldset>
      </form>}
      {saved&&editing&&<Button type="button" size="sm" variant="ghost" onClick={()=>{setDraft(initial());version.current=task.updatedAt?.toISOString()??'';setSaved('');}}>設定を変更</Button>}
      {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}{saved&&<p role="status" className="text-xs">{saved}</p>}
    </div>}
  </section>;
}
