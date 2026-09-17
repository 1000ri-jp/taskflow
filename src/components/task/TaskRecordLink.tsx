'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { getTask, getTaskAttachments, getTaskChecklists, getTaskComments } from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Attachment, Checklist, Comment, Task } from '@/types';
import { TaskAssignees } from '@/components/board/TaskViewFields';
import { TaskHistoryTimeline } from './TaskHistoryTimeline';
import { useAuthStore } from '@/stores/authStore';
interface RecordData {scope:string;task:Task;comments:Comment[];attachments:Attachment[];checklists:Checklist[];issues:string[];commentsReady:boolean}
export function TaskRecordLink({projectId,taskId,task,label,names,record=false,inline=false}:{projectId:string;taskId:string;task?:Task;label:string;names:Record<string,string>;record?:boolean;inline?:boolean}) {
  const [open,setOpen]=useState(false);const [loadedData,setData]=useState<RecordData|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);
  const userId=useAuthStore(s=>s.user?.id);
  const scope=`${userId}/${projectId}/${taskId}`;
  const data=loadedData?.scope===scope?loadedData:null;
  const load=async()=>{
    setOpen(true);setBusy(true);setError('');setData(null);
    try {
      if(isE2EMockAuthEnabled()) {
        const {readTaskDetailsMock}=await import('@/lib/task/detailMock');const found=readTaskDetailsMock(projectId,taskId);
        if(!found.task)throw new Error('統合元の記録が見つかりません。');
        setData({...found,scope,task:found.task,issues:[],commentsReady:true});
      } else {
        const found=await getTask(projectId,taskId);
        if(!found || found.projectId!==projectId)throw new Error('この記録は削除されたか、現在の権限では取得できません。');
        const [comments,attachments,checklists]=await Promise.allSettled([getTaskComments(projectId,taskId),getTaskAttachments(projectId,taskId),getTaskChecklists(projectId,taskId)]);
        const issues:string[]=[];
        if(comments.status==='rejected')issues.push('元コメントを取得できませんでした。');
        if(attachments.status==='rejected')issues.push('元の添付を取得できませんでした。');
        if(checklists.status==='rejected')issues.push('元のチェックリストを取得できませんでした。');
        setData({scope,task:found,comments:comments.status==='fulfilled'?comments.value:[],attachments:attachments.status==='fulfilled'?attachments.value:[],checklists:checklists.status==='fulfilled'?checklists.value:[],issues,commentsReady:comments.status==='fulfilled'});
      }
    }catch{setError('この記録は削除されたか、接続・閲覧権限のため取得できません。元の記録は変更していません。');}
    finally{setBusy(false);}
  };
  if(task&&!task.isArchived&&!record)return <Link className="text-xs text-blue-600 hover:underline" href={`/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(taskId)}`}>{label}</Link>;
  const contents = <>      {busy&&<p role="status" className="text-sm text-muted-foreground">元の記録を取得中…</p>}{error&&<p role="alert" className="text-sm text-amber-700">{error}</p>}
      {data&&<div className="space-y-4 text-sm"><p className="text-xs text-muted-foreground">{data.task.isArchived?'保管中':'登録済み'} · {data.task.isCompleted?'完了':'未完了'} · <TaskAssignees task={data.task} names={names} compact /> · {data.task.dueDate?`期限 ${data.task.dueDate.toLocaleDateString('ja-JP')}`:'期限未指定'}</p>
        {data.task.mergedIntoTaskId&&<Link className="inline-block text-xs text-blue-600 hover:underline" href={`/projects/${encodeURIComponent(projectId)}/board?task=${encodeURIComponent(data.task.mergedIntoTaskId)}`} onClick={()=>setOpen(false)}>統合先の仕事へ戻る</Link>}
        <p className="whitespace-pre-wrap break-words">{data.task.description||'説明は未登録です。'}</p>
        {data.issues.map(issue=><p key={issue} role="alert" className="text-xs text-amber-700">{issue}</p>)}
        {data.checklists.map(checklist=><section key={checklist.id}><h3 className="font-medium">{checklist.title}</h3><ul className="mt-1 space-y-1 text-xs">{[...checklist.items].sort((a,b)=>a.order-b.order).map(item=><li key={item.id}>{item.isChecked?'✓':'○'} {item.text}</li>)}</ul></section>)}
        {!!data.attachments.length&&<section><h3 className="font-medium">元の添付</h3><ul className="mt-1 space-y-1">{data.attachments.map(file=><li key={file.id}>{/^https?:\/\//.test(file.url)?<a className="break-words text-xs text-blue-600 underline" href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a>:<span className="text-xs">{file.name}（リンクを確認できません）</span>}</li>)}</ul></section>}
        {data.comments.some(comment=>comment.attachments?.length)&&<section><h3 className="font-medium">元コメントの添付</h3><ul className="mt-1 space-y-1">{data.comments.flatMap(comment=>(comment.attachments??[]).map(file=><li key={`${comment.id}/${file.id}`}>{/^https?:\/\//.test(file.url)?<a className="break-words text-xs text-blue-600 underline" href={file.url} target="_blank" rel="noopener noreferrer">{file.name}</a>:<span className="text-xs">{file.name}（リンクを確認できません）</span>}</li>))}</ul></section>}
        <TaskHistoryTimeline projectId={projectId} taskId={taskId} userId={userId} comments={data.comments} commentStatus={data.commentsReady?'ready':'error'} names={names} enabled={open} taskUpdatedAt={data.task.updatedAt?.toISOString()} inlineCommentOriginals/>
      </div>}</>;
  const trigger = <button type="button" className="text-left text-xs text-blue-600 hover:underline" onClick={()=>{if(inline&&open)setOpen(false);else void load();}} aria-expanded={inline ? open : undefined}>{label}{task?.isArchived?'（保管済み）':!task&&!record?'（一覧では未取得）':''}</button>;
  if(inline)return <div>{trigger}{open&&<div className="mt-2 border-l pl-3">{contents}</div>}</div>;
  return <>{trigger}<Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{data?.task.title??'元の仕事の記録'}</DialogTitle><DialogDescription>本文・コメント・添付・手順を元の状態で確認できます。</DialogDescription></DialogHeader>{contents}</DialogContent></Dialog></>;
}
