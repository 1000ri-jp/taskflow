import {
  getProjectTasks,
  getTask,
  getProjectLists,
  getTaskChecklists,
  getTaskComments,
} from '@/lib/firebase/firestore';
import { AITool, ToolHandler } from './types';
import type { Task } from '@/types';
import {
  getEffectiveDates,
  isTaskBlocked,
  getBottleneckTask,
  getDependencyTasks,
  getDependentTasks,
} from '@/lib/utils/task';

// ============================================
// get_tasks - タスク一覧を取得
// ============================================

export interface GetTasksArgs {
  listId?: string;
  assigneeId?: string;
  isCompleted?: boolean;
  priority?: 'high' | 'medium' | 'low';
}

export interface TaskSummary {
  id: string;
  title: string;
  listId: string;
  priority: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  assigneeIds: string[];
}

export interface GetTasksResult {
  tasks: TaskSummary[];
  count: number;
}

export const getTasksToolDefinition: AITool = {
  name: 'get_tasks',
  description:
    'プロジェクト内のタスク一覧を取得します。リスト、担当者、完了状態、優先度でフィルタリングできます。',
  parameters: {
    type: 'object',
    properties: {
      listId: {
        type: 'string',
        description: '特定のリストのタスクのみ取得',
      },
      assigneeId: {
        type: 'string',
        description: '特定の担当者のタスクのみ取得',
      },
      isCompleted: {
        type: 'boolean',
        description: '完了状態でフィルタ（true=完了のみ, false=未完了のみ）',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: '優先度でフィルタ',
      },
    },
    required: [],
  },
};

export const getTasksHandler: ToolHandler<GetTasksArgs, GetTasksResult> = async (
  args,
  context
) => {
  const { listId, assigneeId, isCompleted, priority } = args;
  const { projectId } = context;

  let tasks = await getProjectTasks(projectId);

  // Apply filters
  if (listId !== undefined) {
    tasks = tasks.filter((t) => t.listId === listId);
  }
  if (assigneeId !== undefined) {
    tasks = tasks.filter((t) => t.assigneeIds.includes(assigneeId));
  }
  if (isCompleted !== undefined) {
    tasks = tasks.filter((t) => t.isCompleted === isCompleted);
  }
  if (priority !== undefined) {
    tasks = tasks.filter((t) => t.priority === priority);
  }

  const taskSummaries: TaskSummary[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    listId: t.listId,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : null,
    isCompleted: t.isCompleted,
    assigneeIds: t.assigneeIds,
  }));

  return {
    tasks: taskSummaries,
    count: taskSummaries.length,
  };
};

// ============================================
// get_task_details - タスク詳細を取得
// ============================================

export interface GetTaskDetailsArgs {
  projectId?: string;
  taskId: string;
}

/**
 * Dependency task summary for get_task_details
 */
export interface DependencyTaskSummary {
  id: string;
  title: string;
  isCompleted: boolean;
  completedAt: string | null;
  dueDate: string | null;
}

/**
 * Effective dates calculated from dependencies
 */
export interface EffectiveDatesInfo {
  predictedStart: string | null;
  predictedEnd: string | null;
  isDeadlineOverdue: boolean;
}

export interface TaskDetails {
  parentTaskId: string | null;
  automation: import('@/lib/task/automationTypes').TaskAutomationSummary | null;
  recentReports: {content:string;authorId:string;createdAt:string}[];
  id: string;
  title: string;
  description: string;
  listId: string;
  listName: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  durationDays: number | null;
  isDueDateFixed: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  assigneeIds: string[];
  labelIds: string[];
  checklists: Array<{
    id: string;
    title: string;
    items: Array<{ text: string; isChecked: boolean }>;
  }>;
  commentCount: number;
  // Dependency information
  dependsOn: DependencyTaskSummary[];
  dependedBy: DependencyTaskSummary[];
  effectiveDates: EffectiveDatesInfo;
  isBlocked: boolean;
  bottleneckTask: DependencyTaskSummary | null;
}

export interface GetTaskDetailsResult {
  task: TaskDetails;
}

export const getTaskDetailsToolDefinition: AITool = {
  name: 'get_task_details',
  description:
    'タスクの詳細情報を取得します。親子関係、購入・発送・到着予定、最近の報告、チェックリストも含まれます。',
  parameters: {
    type: 'object',
    properties: {
      projectId: {type:'string',description:'ダッシュボードでは対象のプロジェクトID'},
      taskId: {
        type: 'string',
        description: 'タスクのID（必須）',
      },
    },
    required: ['taskId'],
  },
};

export const getTaskDetailsHandler: ToolHandler<GetTaskDetailsArgs, GetTaskDetailsResult> = async (
  args,
  context
) => {
  const { taskId } = args;
  const projectId = context.projectId || args.projectId;
  if(!projectId || !context.projectId && !context.projectIds?.includes(projectId))throw new Error('AIの対象プロジェクトを確認してください。');

  const task = await getTask(projectId, taskId);
  if (!task) {
    throw new Error('タスクが見つかりません');
  }

  const [lists, checklists, comments, allTasks] = await Promise.all([
    getProjectLists(projectId),
    getTaskChecklists(projectId, taskId),
    getTaskComments(projectId, taskId),
    getProjectTasks(projectId),
  ]);

  const list = lists.find((l) => l.id === task.listId);

  // Helper to convert task to dependency summary
  const toDependencySummary = (t: Task): DependencyTaskSummary => ({
    id: t.id,
    title: t.title,
    isCompleted: t.isCompleted,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : null,
  });

  // Get dependency information
  const dependsOnTasks = getDependencyTasks(task, allTasks);
  const dependedByTasks = getDependentTasks(task.id, allTasks);

  // Calculate effective dates
  const effectiveDates = getEffectiveDates(task, allTasks);
  const effectiveDatesInfo: EffectiveDatesInfo = {
    predictedStart: effectiveDates.predictedStart
      ? effectiveDates.predictedStart.toISOString().split('T')[0]
      : null,
    predictedEnd: effectiveDates.predictedEnd
      ? effectiveDates.predictedEnd.toISOString().split('T')[0]
      : null,
    isDeadlineOverdue: effectiveDates.isDeadlineOverdue,
  };

  // Check if blocked and get bottleneck
  const blocked = isTaskBlocked(task, allTasks);
  const bottleneck = getBottleneckTask(task, allTasks);

  const taskDetails: TaskDetails = {
    parentTaskId:task.parentTaskId??null,automation:task.automation??null,
    recentReports:[...comments].sort((a,b)=>a.createdAt.getTime()-b.createdAt.getTime()).slice(-5).map(c=>({content:c.content,authorId:c.authorId,createdAt:c.createdAt.toISOString()})),
    id: task.id,
    title: task.title,
    description: task.description || '',
    listId: task.listId,
    listName: list?.name || 'Unknown',
    priority: task.priority,
    startDate: task.startDate ? task.startDate.toISOString().split('T')[0] : null,
    dueDate: task.dueDate ? task.dueDate.toISOString().split('T')[0] : null,
    durationDays: task.durationDays,
    isDueDateFixed: task.isDueDateFixed,
    isCompleted: task.isCompleted,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    assigneeIds: task.assigneeIds,
    labelIds: task.labelIds,
    checklists: checklists.map((cl) => ({
      id: cl.id,
      title: cl.title,
      items: cl.items.map((item) => ({
        text: item.text,
        isChecked: item.isChecked,
      })),
    })),
    commentCount: comments.length,
    // Dependency information
    dependsOn: dependsOnTasks.map(toDependencySummary),
    dependedBy: dependedByTasks.map(toDependencySummary),
    effectiveDates: effectiveDatesInfo,
    isBlocked: blocked,
    bottleneckTask: bottleneck ? toDependencySummary(bottleneck) : null,
  };

  return {
    task: taskDetails,
  };
};

// ============================================
// get_project_summary - プロジェクト概要を取得
// ============================================

export type GetProjectSummaryArgs = Record<string, never>;

export interface ListSummary {
  id: string;
  name: string;
  taskCount: number;
  completedCount: number;
}

export interface ProjectSummaryResult {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  highPriorityTasks: number;
  lists: ListSummary[];
}

export const getProjectSummaryToolDefinition: AITool = {
  name: 'get_project_summary',
  description:
    'プロジェクトの概要情報を取得します。タスク数、完了数、期限切れ数などの統計を返します。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const getProjectSummaryHandler: ToolHandler<GetProjectSummaryArgs, ProjectSummaryResult> = async (
  _args,
  context
) => {
  const { projectId } = context;

  const [tasks, lists] = await Promise.all([
    getProjectTasks(projectId),
    getProjectLists(projectId),
  ]);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const completedTasks = tasks.filter((t) => t.isCompleted).length;
  const overdueTasks = tasks.filter(
    (t) => !t.isCompleted && t.dueDate && t.dueDate < today
  ).length;
  const highPriorityTasks = tasks.filter(
    (t) => !t.isCompleted && t.priority === 'high'
  ).length;

  const listSummaries: ListSummary[] = lists.map((list) => {
    const listTasks = tasks.filter((t) => t.listId === list.id);
    return {
      id: list.id,
      name: list.name,
      taskCount: listTasks.length,
      completedCount: listTasks.filter((t) => t.isCompleted).length,
    };
  });

  return {
    totalTasks: tasks.length,
    completedTasks,
    overdueTasks,
    highPriorityTasks,
    lists: listSummaries,
  };
};

// ============================================
// get_my_tasks - 自分のタスクを取得
// ============================================

export interface GetMyTasksArgs {
  includeCompleted?: boolean;
}

export interface GetMyTasksResult {
  tasks: TaskSummary[];
  count: number;
}

export const getMyTasksToolDefinition: AITool = {
  name: 'get_my_tasks',
  description:
    '自分（現在のユーザー）に割り当てられたタスク一覧を取得します。',
  parameters: {
    type: 'object',
    properties: {
      includeCompleted: {
        type: 'boolean',
        description: '完了したタスクも含めるか（デフォルト: false）',
      },
    },
    required: [],
  },
};

export const getMyTasksHandler: ToolHandler<GetMyTasksArgs, GetMyTasksResult> = async (
  args,
  context
) => {
  const { includeCompleted = false } = args;
  const { projectId, userId } = context;

  let tasks = await getProjectTasks(projectId);

  // Filter by current user
  tasks = tasks.filter((t) => t.assigneeIds.includes(userId));

  // Filter by completion status
  if (!includeCompleted) {
    tasks = tasks.filter((t) => !t.isCompleted);
  }

  const taskSummaries: TaskSummary[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    listId: t.listId,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : null,
    isCompleted: t.isCompleted,
    assigneeIds: t.assigneeIds,
  }));

  return {
    tasks: taskSummaries,
    count: taskSummaries.length,
  };
};

// ============================================
// get_overdue_tasks - 期限切れタスクを取得
// ============================================

export type GetOverdueTasksArgs = Record<string, never>;

export interface GetOverdueTasksResult {
  tasks: TaskSummary[];
  count: number;
}

export const getOverdueTasksToolDefinition: AITool = {
  name: 'get_overdue_tasks',
  description:
    '期限が過ぎている未完了タスクの一覧を取得します。',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

export const getOverdueTasksHandler: ToolHandler<GetOverdueTasksArgs, GetOverdueTasksResult> = async (
  _args,
  context
) => {
  const { projectId } = context;

  const tasks = await getProjectTasks(projectId);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const overdueTasks = tasks.filter(
    (t) => !t.isCompleted && t.dueDate && t.dueDate < today
  );

  const taskSummaries: TaskSummary[] = overdueTasks.map((t) => ({
    id: t.id,
    title: t.title,
    listId: t.listId,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split('T')[0] : null,
    isCompleted: t.isCompleted,
    assigneeIds: t.assigneeIds,
  }));

  return {
    tasks: taskSummaries,
    count: taskSummaries.length,
  };
};
