/**
 * Plan Generation Tools
 * Provides tools for bulk task generation with dependencies
 */

import { createTask, getProjectTasks } from '@/lib/firebase/firestore';
import { AITool, ToolHandler } from './types';
import { validateTask } from './validation';
import { addDays } from 'date-fns';

// ============================================
// generate_task_plan - タスク計画生成（プレビュー）
// ============================================

export interface Milestone {
  title: string;
  targetDate?: string;
}

export interface GenerateTaskPlanArgs {
  goal: string;
  milestones: Milestone[];
  startDate?: string;
  listId?: string;
  defaultDurationDays?: number;
}

export interface PlannedTask {
  tempId: string;
  title: string;
  description: string;
  durationDays: number;
  startDate: string;
  dueDate: string;
  dependsOnTempIds: string[];
  priority: 'high' | 'medium' | 'low';
  milestone?: string;
}

export interface GenerateTaskPlanResult {
  goal: string;
  tasks: PlannedTask[];
  totalDays: number;
  estimatedEndDate: string;
  warnings: string[];
}

export const generateTaskPlanToolDefinition: AITool = {
  name: 'generate_task_plan',
  description:
    'ゴールとマイルストーンから依存関係付きのタスク計画を生成します（プレビュー）。実際のタスク作成にはexecute_task_planを使用してください。',
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: '達成したいゴール（必須）',
      },
      milestones: {
        type: 'array',
        description: 'マイルストーンの配列。各マイルストーンは中間目標を表します。',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'マイルストーンのタイトル',
            },
            targetDate: {
              type: 'string',
              description: '目標日（ISO 8601形式）',
            },
          },
          required: ['title'],
        },
      },
      startDate: {
        type: 'string',
        description: '計画の開始日（ISO 8601形式）。省略時は今日。',
      },
      listId: {
        type: 'string',
        description: 'タスクを作成するリストID。execute_task_planで必須。',
      },
      defaultDurationDays: {
        type: 'number',
        description: 'デフォルトの所要日数（省略時: 1日）',
      },
    },
    required: ['goal', 'milestones'],
  },
};

/**
 * Generate a task plan from goal and milestones
 * This is a template-based approach - in practice, AI would provide the task breakdown
 */
export const generateTaskPlanHandler: ToolHandler<
  GenerateTaskPlanArgs,
  GenerateTaskPlanResult
> = async (args) => {
  const {
    goal,
    milestones,
    startDate: startDateStr,
    defaultDurationDays = 1,
  } = args;

  const warnings: string[] = [];
  const tasks: PlannedTask[] = [];

  const startDate = startDateStr ? new Date(startDateStr) : new Date();
  let currentDate = new Date(startDate);
  let tempIdCounter = 1;

  // Generate tasks for each milestone
  let previousMilestoneTaskId: string | null = null;

  for (let i = 0; i < milestones.length; i++) {
    const milestone = milestones[i];
    const milestoneTargetDate = milestone.targetDate
      ? new Date(milestone.targetDate)
      : null;

    // Create a task for the milestone itself
    const milestoneTempId = `temp_${tempIdCounter++}`;

    // Calculate duration based on target date if provided
    let milestoneDuration = defaultDurationDays;
    if (milestoneTargetDate) {
      const daysUntilTarget = Math.ceil(
        (milestoneTargetDate.getTime() - currentDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilTarget > 0) {
        milestoneDuration = Math.max(1, daysUntilTarget);
      } else {
        warnings.push(
          `マイルストーン「${milestone.title}」の目標日が開始日より前です。日程を調整してください。`
        );
      }
    }

    const taskStartDate = new Date(currentDate);
    const taskDueDate = addDays(taskStartDate, milestoneDuration - 1);

    const milestoneTask: PlannedTask = {
      tempId: milestoneTempId,
      title: milestone.title,
      description: `マイルストーン: ${milestone.title}\nゴール「${goal}」の一部`,
      durationDays: milestoneDuration,
      startDate: taskStartDate.toISOString().split('T')[0],
      dueDate: taskDueDate.toISOString().split('T')[0],
      dependsOnTempIds: previousMilestoneTaskId ? [previousMilestoneTaskId] : [],
      priority: i === milestones.length - 1 ? 'high' : 'medium',
      milestone: milestone.title,
    };

    tasks.push(milestoneTask);

    // Update for next milestone
    currentDate = addDays(taskDueDate, 1);
    previousMilestoneTaskId = milestoneTempId;
  }

  // Calculate total days and end date
  const totalDays = tasks.reduce((sum, t) => sum + t.durationDays, 0);
  const estimatedEndDate =
    tasks.length > 0
      ? tasks[tasks.length - 1].dueDate
      : startDate.toISOString().split('T')[0];

  if (!args.listId) {
    warnings.push(
      'listIdが指定されていません。execute_task_planを実行する際にlistIdを指定してください。'
    );
  }

  return {
    goal,
    tasks,
    totalDays,
    estimatedEndDate,
    warnings,
  };
};

// ============================================
// execute_task_plan - タスク計画実行
// ============================================

export interface ExecuteTaskPlanArgs {
  tasks: PlannedTask[];
  listId: string;
}

export interface CreatedTask {
  tempId: string;
  actualId: string;
  title: string;
  success: boolean;
  error?: string;
}

export interface ExecuteTaskPlanResult {
  createdTasks: CreatedTask[];
  totalCreated: number;
  totalFailed: number;
  idMapping: Record<string, string>;
}

export const executeTaskPlanToolDefinition: AITool = {
  name: 'execute_task_plan',
  description:
    'generate_task_planで生成されたタスク計画を実行し、実際のタスクを作成します。tempIdは実際のタスクIDに変換されます。',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'generate_task_planで生成されたタスク配列',
        items: {
          type: 'object',
          properties: {
            tempId: {
              type: 'string',
              description: '一時ID',
            },
            title: {
              type: 'string',
              description: 'タスクタイトル',
            },
            description: {
              type: 'string',
              description: 'タスク説明',
            },
            durationDays: {
              type: 'number',
              description: '所要日数',
            },
            startDate: {
              type: 'string',
              description: '開始日',
            },
            dueDate: {
              type: 'string',
              description: '期限',
            },
            dependsOnTempIds: {
              type: 'array',
              items: { type: 'string' },
              description: '依存タスクの一時ID配列',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: '優先度',
            },
          },
          required: ['tempId', 'title', 'durationDays', 'startDate', 'dueDate'],
        },
      },
      listId: {
        type: 'string',
        description: 'タスクを作成するリストID（必須）',
      },
    },
    required: ['tasks', 'listId'],
  },
};

export const executeTaskPlanHandler: ToolHandler<
  ExecuteTaskPlanArgs,
  ExecuteTaskPlanResult
> = async (args, context) => {
  const { tasks, listId } = args;
  const { projectId, userId } = context;

  if (!listId) {
    throw new Error('listIdが必須です。get_listsで利用可能なリストを確認してください。');
  }

  // Map from tempId to actual taskId
  const idMapping: Record<string, string> = {};
  const createdTasks: CreatedTask[] = [];

  // Get existing tasks for validation
  const existingTasks = await getProjectTasks(projectId);

  // Create tasks in order (to maintain dependencies)
  for (const plannedTask of tasks) {
    try {
      // Convert tempIds to actual IDs for dependencies
      const actualDependsOnIds = (plannedTask.dependsOnTempIds || [])
        .map((tempId) => idMapping[tempId])
        .filter((id): id is string => id !== undefined);

      // Validate the task
      const validation = validateTask({
        startDate: plannedTask.startDate,
        dueDate: plannedTask.dueDate,
        durationDays: plannedTask.durationDays,
        dependsOnTaskIds: actualDependsOnIds,
        allTasks: [...existingTasks],
      });

      if (!validation.valid) {
        createdTasks.push({
          tempId: plannedTask.tempId,
          actualId: '',
          title: plannedTask.title,
          success: false,
          error: validation.errors.join('; '),
        });
        continue;
      }

      // Create the task
      const taskId = await createTask(projectId, {
        listId,
        title: plannedTask.title,
        description: plannedTask.description || '',
        order: Date.now(),
        // Omitted assignment uses the project default; model guesses are not assignments.
        aiSuggested: true,
        labelIds: [],
        tagIds: [],
        dependsOnTaskIds: actualDependsOnIds,
        priority: plannedTask.priority || null,
        startDate: new Date(plannedTask.startDate),
        dueDate: new Date(plannedTask.dueDate),
        durationDays: plannedTask.durationDays,
        isDueDateFixed: false,
        isCompleted: false,
        completedAt: null,
        isAbandoned: false,
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        createdBy: userId,
      });

      // Store mapping
      idMapping[plannedTask.tempId] = taskId;

      createdTasks.push({
        tempId: plannedTask.tempId,
        actualId: taskId,
        title: plannedTask.title,
        success: true,
      });

      // Add to existing tasks for subsequent validation
      existingTasks.push({
        id: taskId,
        projectId,
        listId,
        title: plannedTask.title,
        description: plannedTask.description || '',
        order: Date.now(),
        assigneeIds: [], // Dependency validation uses dates only; this is not a persisted assignment.
        aiSuggested: true,
        labelIds: [],
        tagIds: [],
        dependsOnTaskIds: actualDependsOnIds,
        priority: plannedTask.priority || null,
        startDate: new Date(plannedTask.startDate),
        dueDate: new Date(plannedTask.dueDate),
        durationDays: plannedTask.durationDays,
        isDueDateFixed: false,
        isCompleted: false,
        completedAt: null,
        isAbandoned: false,
        isArchived: false,
        archivedAt: null,
        archivedBy: null,
        createdBy: userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    } catch (error) {
      createdTasks.push({
        tempId: plannedTask.tempId,
        actualId: '',
        title: plannedTask.title,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  const totalCreated = createdTasks.filter((t) => t.success).length;
  const totalFailed = createdTasks.filter((t) => !t.success).length;

  return {
    createdTasks,
    totalCreated,
    totalFailed,
    idMapping,
  };
};
