'use client';
import { resolveTaskAssignees } from '@/lib/task/assigneeDefaults';
import { MOAI_LABEL, MOAI_LABEL_ID } from '@/lib/task/moaiLabel';
import { assertTaskDates, hasTaskDateChange } from '@/lib/task/dateValidation';
import { repeatMockTask } from '@/lib/task/recurrenceClient';
import { useMemo } from 'react';
import type { List, Task } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useOrganizationLabTasks } from './useOrganizationLabTasks';
import { mutateOrganizationMock, readOrganizationMock } from '@/lib/task/organizationMock';
import { MEETING_MOCK_PROJECTS } from '@/lib/task/meetingMultiExample';
import { completionBlockReason } from '@/lib/task/completion';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { taskVersion } from '@/lib/task/workflow';
import { assertOrganizationGraphSafe } from '@/lib/task/organizationEngine';

const emptyTasks: Task[] = [];

/** Only the explicit shared browser workbench is writable here. There are no Firebase imports. */
export function useOrganizationLabBoard(enabled: boolean, projectId: string | null) {
  const uid = useAuthStore(s => s.user?.id ?? null);
  const lab = useOrganizationLabTasks(enabled, uid);
  const sourceTasks = lab.allProjectTasks.length ? lab.allProjectTasks : emptyTasks;
  const tasks = useMemo(() => sourceTasks.filter(task => task.projectId === projectId), [sourceTasks, projectId]);
  const activeTasks = useMemo(() => tasks.filter(task => !task.isArchived), [tasks]);
  const lists: List[] = useMemo(() => {
    if (!enabled || !projectId) return [];
    const saved=readOrganizationMock(projectId);
    return saved.data.listIds.map((id,order)=>saved.lists?.find(l=>l.id===id)??{id,projectId,name:id==='doing'?'進行中':'リスト',color:'#64748b',order,autoCompleteOnEnter:false,autoUncompleteOnExit:false,autoSetStartDateOnEnter:false,createdAt:new Date(0),updatedAt:new Date(0)});
    // Task snapshots refresh on every shared workbench save, including a list-only change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, projectId, tasks]);
  const editTask = async (taskId: string, patch: Partial<Task>) => {
    if (!enabled || !projectId || !MEETING_MOCK_PROJECTS.some(project => project.id === projectId)) throw new Error('隔離作業台の対象ではありません。');
    await mutateOrganizationMock(projectId, work => {
      const task = work.data.tasks[taskId]; if (!task) throw new Error('タスクが見つかりません。');
      if ('automation' in patch || 'completionPolicy' in patch || 'review' in patch || task.taskKind === 'review_request' && ('isCompleted' in patch || 'completedAt' in patch)) throw new Error('自動更新の条件は専用操作から変更してください。');
      const after = { ...task, ...patch, updatedAt: new Date() };
      if (hasTaskDateChange(patch)) assertTaskDates(after);
      if (patch.isCompleted === true) {const reason=completionBlockReason({...task,id:taskId,projectId} as Task,Object.entries(work.data.tasks).map(([id,t])=>({...t,id} as Task)));if(reason)throw new Error(reason);}
      if (patch.isCompleted === true) repeatMockTask(work, { ...after, id:taskId, projectId } as Task);
      assertOrganizationGraphSafe({ ...work.data.tasks, [taskId]: after }); work.data.tasks[taskId] = after;
      work.activityLogs.push({ id: crypto.randomUUID(), projectId, targetType: 'task', targetId: taskId, targetName: after.title, userId: uid, userName: '隔離環境の本人', action: 'update',
        changes: Object.entries(patch).map(([field, value]) => ({ field, oldValue: String(task[field] ?? ''), newValue: String(value ?? '') })), createdAt: new Date() });
    });
  };
  const addTask = async (listId: string, title: string, createdBy: string, position: 'top'|'bottom' = 'bottom', defaults: Partial<Task> = {}) => {
    if (!enabled || !projectId || createdBy !== uid || !MEETING_MOCK_PROJECTS.some(p => p.id === projectId) || !title.trim()) throw new Error('隔離作業台の追加先を確認してください。');
    assertTaskDates(defaults);
    return mutateOrganizationMock(projectId, work => {
      if (!work.data.listIds.includes(listId)) throw new Error('リストが見つかりません。');
      if (defaults.parentTaskId) {
        const parent = work.data.tasks[defaults.parentTaskId];
        if (!parent || parent.parentTaskId || parent.taskKind === 'review_request' || parent.isArchived || parent.isAbandoned || parent.listId !== listId) throw new Error('親タスクが変更されました。開き直してください。');
      }
      const assigneeIds = resolveTaskAssignees({ explicit: defaults.assigneeIds, parent: defaults.parentTaskId ? { assigneeIds: work.data.tasks[defaults.parentTaskId].assigneeIds as string[] ?? [] } : null,
        defaultAssigneeId: work.data.defaultAssigneeId, listDefaultAssigneeId: work.data.listDefaultAssigneeIds?.[listId], memberIds: work.data.memberIds });
      if (assigneeIds.some(id => !work.data.memberIds.includes(id))) throw new Error('担当者がプロジェクトのメンバーに含まれていません。');
      const now=new Date(), id=crypto.randomUUID();
      const orders=Object.values(work.data.tasks).filter(t=>t.listId===listId).map(t=>Number(t.order)||0);
      work.data.tasks[id]={projectId,listId,title:title.trim(),description:'',order:position==='top'?Math.min(0,...orders)-1:Math.max(0,...orders)+1,
        ...(defaults.parentTaskId ? { parentTaskId: defaults.parentTaskId } : {}),
        assigneeIds,labelIds:[],tagIds:[],dependsOnTaskIds:[],priority:null,startDate:defaults.startDate??null,dueDate:defaults.dueDate??null,durationDays:null,isDueDateFixed:false,
        isCompleted:false,completedAt:null,isArchived:false,isAbandoned:false,archivedAt:null,archivedBy:null,createdBy,createdAt:now,updatedAt:now}; return id;
    });
  };
  const addList = async (name:string) => {if(!projectId||!enabled)throw new Error('追加先を確認してください。');return mutateOrganizationMock(projectId,work=>{const id=crypto.randomUUID();work.data.listIds.push(id);work.lists=[...(work.lists??[]),{id,projectId,name,color:'#64748b',order:work.data.listIds.length-1,autoCompleteOnEnter:false,autoUncompleteOnExit:false,autoSetStartDateOnEnter:false,createdAt:new Date(),updatedAt:new Date()}];return id;});};
  const unsupported = async () => { throw new Error('この隔離作業台では、タスクの編集と整理の反映を検証できます。'); };
  return {
    lists, tasks: activeTasks, allTasks: tasks, labels: projectId && tasks.some(task => task.labelIds?.includes(MOAI_LABEL_ID)) ? [{id:MOAI_LABEL_ID,projectId,...MOAI_LABEL,createdAt:new Date(0)}] : [], tags: [], isLoading: lab.isLoading, error: lab.error,
    getTasksByListId: (id: string) => tasks.filter(t => !t.isArchived && t.listId === id).sort((a, b) => a.order - b.order),
    editTask, removeTask: async (id: string) => editTask(id, { isArchived: true, archivedAt: new Date(), archivedBy: uid }),
    moveTask: async (id: string, listId: string, order: number) => editTask(id, { listId, order }),
    changeTaskParent: async (id: string, parentTaskId: string | null) => {const task=tasks.find(t=>t.id===id);if(!task||!projectId)throw new Error('仕事が見つかりません。');await sendWorkflow(projectId,id,{id:crypto.randomUUID(),action:'reparent',expectedVersion:taskVersion(task),parentTaskId});},
    reorderTasks: async (_listId: string, ids: string[]) => { for (const [order, id] of ids.entries()) await editTask(id, { order }); },
    addTask, addList, editList: unsupported, removeList: unsupported, reorderLists: unsupported, duplicateTask: unsupported,
  };
}
