import { expandTaskReviews } from './reviews';
import { repeatMockTask } from './recurrenceClient';
import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { planWorkflow, workflowReceipt, type WorkflowInput, type WorkflowReceipt } from './workflow';
import type { Task } from '@/types';
export async function sendWorkflow(projectId: string, taskId: string, input: WorkflowInput): Promise<WorkflowReceipt | null> {
  if (isE2EMockAuthEnabled()) {
    const { mutateOrganizationMock } = await import('./organizationMock');
    return mutateOrganizationMock(projectId, state => {
      const receipt = state.activityLogs.find(log => log.id === `workflow-${input.id}`);
      if (receipt) {
        if (receipt.targetId !== taskId || receipt.workflowAction !== input.action) throw new Error('操作の記録が一致しません。');
        return (receipt.receipt as WorkflowReceipt | undefined) ?? null;
      }
      const tasks = expandTaskReviews(Object.entries(state.data.tasks).map(([id, data]) => ({ ...data, id }) as unknown as Task));
      const task = tasks.find(t => t.id === taskId); if (!task) throw new Error('仕事が見つかりません。');
      const now = new Date(); let plan;
      try {
        plan = planWorkflow(task, tasks, 'e2e-mock-user', input, now);
        if (input.action === 'configure' && input.details?.milestoneId && !state.milestones?.some(m => m.id === input.details!.milestoneId)) throw new Error('関連する節目を確認できません。');
      } catch (e) { throw Object.assign(e instanceof Error ? e : new Error('操作を確認してください。'), { code: 'workflow-rejected' }); }
      if (plan.patch.isCompleted === true) repeatMockTask(state, { ...task, ...plan.patch });
      if (task.reviewRecordId) {
        const parent = state.data.tasks[task.parentTaskId!] as unknown as Task;
        const saved = parent.reviewRequests![task.reviewRecordId];
        parent.reviewRequests = { ...parent.reviewRequests, [task.reviewRecordId]: { ...saved, cycle: plan.patch.review ?? task.review!, updatedAt: now.toISOString() } }; parent.updatedAt = now;
      } else state.data.tasks[taskId] = { ...state.data.tasks[taskId], ...plan.patch, updatedAt: now };
      if ('clearTaskKind' in plan && plan.clearTaskKind) delete state.data.tasks[taskId].taskKind;
      if(input.action==='resubmit' && task.sourceCommentId) state.notificationReads=(state.notificationReads??[]).filter(id=>!task.assigneeIds.some(uid=>id===`${task.sourceCommentId}:${uid}`));
      const resultReceipt = workflowReceipt(task, tasks, input, now, plan, []);
      const record = { id: `workflow-${input.id}`, targetType: 'task', targetId: taskId, action: 'update', workflowAction: input.action,
        userId: 'e2e-mock-user', userName: '本人', createdAt: now, changes: [{ field: 'workEvent', newValue: plan.text }], before: task, after: plan.patch, receipt: resultReceipt };
      state.activityLogs.push(record);
      if (task.parentTaskId) state.activityLogs.push({ ...record, id: `workflow-parent-${input.id}`, targetId: task.parentTaskId });
      return resultReceipt;
    });
  }
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/workflow`, { method: 'POST', headers: await getAuthHeaders(), body: JSON.stringify(input) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || '保存できませんでした。同じ操作を再試行してください。'), { code: result.rejected ? 'workflow-rejected' : 'workflow-uncertain' });
  window.dispatchEvent(new Event('taskflow-work-updated'));
  return result.receipt ?? null;
}
