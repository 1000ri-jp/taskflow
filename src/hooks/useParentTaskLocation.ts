'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useAuthStore} from '@/stores/authStore';
import {doc,getDoc} from 'firebase/firestore';
import {getFirebaseDb} from '@/lib/firebase/config';
import {isE2EMockAuthEnabled} from '@/lib/firebase/testMode';
import type {Task} from '@/types';

export function resolveParentTask(tasks: Task[], projectId:string, requestedId:string|null) {
 const requested=tasks.find(t=>t.projectId===projectId&&t.id===requestedId)??null;
 let task=requested;const visited=new Set<string>();
 while(task?.parentTaskId){if(visited.has(task.id))return {task:null,requested};visited.add(task.id);task=tasks.find(t=>t.projectId===projectId&&t.id===task!.parentTaskId)??null;}
 return {task,requested};
}
/** Old URLs resolve through the original receipt; no replacement records are written. */
export function useParentTaskLocation(tasks:Task[], projectId:string, requestedId:string|null, loading:boolean) {
 const router=useRouter();
 const {user}=useAuthStore();
 const resolved=resolveParentTask(tasks,projectId,requestedId);
 const [legacy,setLegacy]=useState<{scope:string;parentId:string;commentId:string}|null>(null);
 const [failure,setFailure]=useState<string|null>(null);
 const scope=projectId+'/'+requestedId;
 const requestedFound=!!resolved.requested;
 useEffect(()=>{
  if(loading||!requestedId||requestedFound||!user?.id)return;
  let active=true;
  void import('@/lib/task/projectMoveClient').then(({locateProjectMove})=>locateProjectMove(projectId,requestedId)).then(location=>{
   if(!active||!location)return;
   const query=new URLSearchParams(window.location.search);query.set('task',location.taskId);
   if(location.commentId)query.set('comment',location.commentId);
   router.replace(`/projects/${encodeURIComponent(location.projectId)}/board?${query.toString()}`);
  }).catch(()=>{/* Existing missing-task state stays available when the location is unavailable. */});
  return()=>{active=false;};
 },[loading,requestedId,requestedFound,projectId,user?.id,router]);
 useEffect(()=>{
  if(loading||!requestedId||requestedFound||!requestedId.startsWith('review-'))return;
  let active=true;
  const commentId=requestedId.slice(7);
  const read=async()=>{
   try{
    let record:Record<string,unknown>|undefined;
    if(isE2EMockAuthEnabled()) {const {readOrganizationMock}=await import('@/lib/task/organizationMock');record=readOrganizationMock(projectId).activityLogs.find(log=>log.id==='comment-'+commentId);}
    else record=(await getDoc(doc(getFirebaseDb(),'projects',projectId,'activityLogs','comment-'+commentId))).data();
    if(!record||typeof record.sourceTaskId!=='string'||record.commentId!==commentId)throw new Error('missing');
    if(active)setLegacy({scope,parentId:record.sourceTaskId,commentId});
   }catch{if(active)setFailure(scope);}
  };void read();return()=>{active=false;};
 },[scope,projectId,requestedId,loading,requestedFound]);
 const recovered=legacy?.scope===scope?legacy:null;
 return {task:resolved.task??(recovered?resolveParentTask(tasks,projectId,recovered.parentId).task:null),
  commentId:resolved.requested?.taskKind==='review_request'?resolved.requested.sourceCommentId:recovered?.commentId,
  subtaskId:resolved.requested?.parentTaskId&&resolved.requested.taskKind!=='review_request'?resolved.requested.id:null,
  missing:!loading&&!!requestedId&&!resolved.task&&(!requestedId.startsWith('review-')||failure===scope),
 };
}
