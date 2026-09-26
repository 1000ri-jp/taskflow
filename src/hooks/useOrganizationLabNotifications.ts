'use client';

import {jstDay} from '@/lib/secretary/engine';
import { useEffect, useState } from 'react';
import type { Notification, Task } from '@/types';
import type { OrganizationMock } from '@/lib/task/organizationMock';
import {expandTaskReviews, requiresReviewResponse} from '@/lib/task/reviews';
import {STAGE_LABELS} from '@/lib/task/automationTypes';
import { reminderDue, requiredChildrenState } from '@/lib/task/automationEngine';
import { isStrictDeadlineTask } from '@/lib/task/deadlinePolicy';

const iso = (value: unknown) => value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

/** Mirror pending product notifications from the saved isolated workbench without writing any state. */
export function organizationLabNotifications(work: OrganizationMock, userId: string, now: Date): Notification[] {
  if (!work.data.memberIds.includes(userId)) return [];
  const state = work.automationStates?.[userId];

  const tasks = expandTaskReviews(Object.entries(work.data.tasks).map(([id, task]) => ({ ...task, id } as unknown as Task)));
  const requests: Notification[] = tasks.filter(t=>t.taskKind==='review_request'&&t.assigneeIds.includes(userId)&&t.sourceCommentId).map(t=>({id:`${t.sourceCommentId}:${userId}`,userId,senderId:t.createdBy,senderName:t.createdBy==='demo-colleague'?'同僚':'本人',type:'review_requested',title:'確認依頼',message:t.review?.request??t.description,projectId:t.projectId,taskId:t.parentTaskId!,taskName:tasks.find(p=>p.id===t.parentTaskId)?.title??t.title,isRead:!!work.notificationReads?.includes(`${t.sourceCommentId}:${userId}`),createdAt:t.createdAt,data:{...(t.dueDate?{dueDate:jstDay(t.dueDate.toISOString())}:{}),urgency:t.review?.urgency,requiresResponse:requiresReviewResponse(t,userId),sourceTaskId:t.parentTaskId,commentId:t.sourceCommentId}}));
  const strictDeadlines: Notification[] = tasks.filter(t => isStrictDeadlineTask(t) && t.assigneeIds.includes(userId) && !t.isCompleted && !t.isArchived && !t.isAbandoned && !!iso(t.dueDate)).map(t => ({
    id: `strict-deadline:${t.projectId}:${t.id}`,
    userId,
    type: 'due_reminder',
    title: '期限厳守の仕事があります',
    message: `「${t.title}」は${new Date(t.dueDate!).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false }).replace(/:00$/, '')}に必ず処理。完了するまでモアイに表示します。`,
    projectId: t.projectId,
    taskId: t.id,
    taskName: t.title,
    isRead: false,
    createdAt: t.createdAt,
    data: { strictDeadline: true, requiresResponse: true, dueDate: iso(t.dueDate) },
  }));
  if (!state || state.uid !== userId) return requests.concat(strictDeadlines);
  const orders:Notification[]=state.grants.filter(g=>g.rule.order&&g.records.length).flatMap(g=>{
    const record=g.records.at(-1)!;const task=work.data.tasks[g.rule.taskId];if(!task||record.undone)return [];
    const summary=task.automation as import('@/lib/task/automationTypes').TaskAutomationSummary;
    const id=`order-lab-${g.rule.taskId}-${record.sourceId}-${record.sourceVersion}`;
    const late=!!(summary.expectedDate&&iso(task.dueDate)&&summary.expectedDate>jstDay(iso(task.dueDate)!));
    return [{id,userId,type:'task_updated',title:late?'到着予定が仕事の期限を過ぎます':'名刺の状況が変わりました',message:`${g.rule.order!.merchant}の${g.rule.order!.item}：${STAGE_LABELS[summary.stage!]}${summary.expectedDate?`。到着予定は${summary.expectedDate}です`:''}`,projectId:g.rule.projectId,taskId:g.rule.taskId,taskName:String(task.title),isRead:!!work.notificationReads?.includes(id),createdAt:new Date(record.at),data:{automation:true,requiresResponse:late}}];
  });
  return requests.concat(strictDeadlines, orders,state.reminders.flatMap(reminder => {
    const parent = tasks.find(task => task.id === reminder.taskId && task.projectId === reminder.projectId);
    if (!parent || parent.isCompleted || parent.isArchived || parent.isAbandoned || parent.completionPolicy?.grantedBy !== userId) return [];
    const dueDate = iso(parent.dueDate);
    if (!reminderDue(dueDate, now.toISOString(), reminder.snoozedUntil)) return [];
    const result = requiredChildrenState(parent, tasks.filter(task => task.parentTaskId === parent.id));
    if (!result || result.complete) return [];
    const pending = result.rows.filter(row => !row.complete).map(row => ({ taskId: row.taskId, assigneeId: row.assigneeId, check: row.task?.automation?.check ?? 'unconfirmed' }));
    const scheduled = Math.max(Date.parse(dueDate!) - 86400000, Date.parse(parent.completionPolicy.grantedAt) || 0, Date.parse(reminder.snoozedUntil ?? '') || 0);
    return [{ id: `task-automation-lab-${JSON.stringify([userId, reminder.projectId, parent.id])}`, userId, type: 'due_reminder' as const,
      title: '全員分の完了をまだ確認できません', message: `「${parent.title}」で${pending.length}人分の完了が未確認です。担当ごとの確認状況を開けます。`,
      projectId: reminder.projectId, projectName: '架空の制作・チケット準備', taskId: parent.id, taskName: parent.title, isRead: false,
      createdAt: new Date(Math.min(scheduled, now.getTime())), data: { automation: true, dueDate, pending } }];
  }));
}

export function useOrganizationLabNotifications(enabled: boolean, userId: string | null) {
  const [snapshot, setSnapshot] = useState<{ userId: string; notifications: Notification[]; error: Error | null } | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    let unsubscribe = () => {};
    void import('@/lib/task/organizationMock').then(({ ORGANIZATION_MOCK_PROJECT: projectId, organizationMockKey, readOrganizationMock }) => {
      if (!active) return;
      const read = () => {
        if (!active) return;
        try {
          const saved = localStorage.getItem(organizationMockKey(projectId));
          const notifications = saved ? organizationLabNotifications(readOrganizationMock(projectId), userId, new Date()) : [];
          setSnapshot({ userId, notifications, error: null });
        } catch { setSnapshot({ userId, notifications: [], error: new Error('隔離環境の通知を取得できません。保存内容は変更していません。') }); }
      };
      const onStorage = (event: StorageEvent) => { if (event.key === organizationMockKey(projectId)) read(); };
      window.addEventListener('taskflow-work-updated', read); window.addEventListener('storage', onStorage);
      unsubscribe = () => { window.removeEventListener('taskflow-work-updated', read); window.removeEventListener('storage', onStorage); };
      read();
    }).catch(() => { if (active) setSnapshot({ userId, notifications: [], error: new Error('隔離環境の通知を取得できません。') }); });
    return () => { active = false; unsubscribe(); };
  }, [enabled, userId]);
  // Preserve the last notification snapshot while the mini is hidden. The
  // effect unsubscribes while inactive and reads again when it is shown.
  const current = snapshot?.userId === userId ? snapshot : null;
  return { notifications: current?.notifications ?? [], isLoading: false, error: current?.error ?? null };
}
