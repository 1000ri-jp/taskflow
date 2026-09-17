import { createTask, getProjectTasks } from '@/lib/firebase/firestore';
import {
  AITool,
  ToolHandler,
  CreateTaskArgs,
  CreateTaskResult,
  CreateTasksArgs,
  CreateTasksResult,
} from './types';
import { validateTask, checkDeadlineOverdue } from './validation';
import { calculateEffectiveStartDate } from '@/lib/utils/task';

/**
 * create_task tool definition
 */
export const createTaskToolDefinition: AITool = {
  name: 'create_task',
  description:
    'プロジェクトに新しいタスクを作成します。ユーザーが「〜したい」「〜する必要がある」などと言った場合に使用してください。listIdを指定しない場合はデフォルトのリストに作成されます。依存関係を設定する場合は、先に依存先のタスクを作成してそのtaskIdを使用してください。',
  parameters: {
    type: 'object',
    properties: {
      assigneeIds: { type: 'array', items: { type: 'string' }, description: '本人が明示した担当者IDだけ指定。候補や推測は省略しプロジェクト主担当を初期値にする。意図的な担当未設定だけ空配列。' },
      title: {
        type: 'string',
        description: 'タスクのタイトル（必須）',
      },
      description: {
        type: 'string',
        description: 'タスクの詳細説明',
      },
      priority: {
        type: 'string',
        enum: ['high', 'medium', 'low'],
        description: '優先度（high=高, medium=中, low=低）',
      },
      startDate: {
        type: 'string',
        description: '開始日（ISO 8601形式、例: 2026-01-24）。ガントチャートで使用。',
      },
      durationDays: {
        type: 'number',
        description: '所要日数。startDateと組み合わせて使用すると、終了日が自動計算される（終了日 = 開始日 + 所要日数 - 1）。例: 3日間のタスク。',
      },
      dueDate: {
        type: 'string',
        description: '期限/終了日（ISO 8601形式）。durationDaysを指定した場合は自動計算されるため不要。',
      },
      isDueDateFixed: {
        type: 'boolean',
        description: '期限固定フラグ。true=期限を固定（duration変更時も期限は変わらない）、false=duration優先（開始日変更時に期限も自動調整）。デフォルトはfalse。',
      },
      listId: {
        type: 'string',
        description: 'タスクを追加するリストのID。get_listsで取得したIDを使用。指定しない場合はデフォルトのリストに追加。',
      },
      dependsOnTaskIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'このタスクが依存する（先に完了すべき）タスクのID配列。依存タスクが完了するまでこのタスクは開始できない。',
      },
    },
    required: ['title'],
  },
};

/**
 * create_tasks tool definition (for multiple tasks)
 */
export const createTasksToolDefinition: AITool = {
  name: 'create_tasks',
  description:
    '複数のタスクを一度に作成します。依存関係のあるタスクを作成する場合は、create_taskを順番に呼び出して、先に作成したタスクのIDを依存先として使用してください。',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: '作成するタスクの配列（依存関係がない場合に使用）',
        items: {
          type: 'object',
          properties: {
            assigneeIds: { type: 'array', items: { type: 'string' }, description: '本人が明示した担当者IDだけ指定。候補や推測は省略しプロジェクト主担当を初期値にする。意図的な担当未設定だけ空配列。' },
            title: {
              type: 'string',
              description: 'タスクのタイトル（必須）',
            },
            description: {
              type: 'string',
              description: 'タスクの詳細説明',
            },
            priority: {
              type: 'string',
              enum: ['high', 'medium', 'low'],
              description: '優先度',
            },
            startDate: {
              type: 'string',
              description: '開始日（ISO 8601形式）',
            },
            durationDays: {
              type: 'number',
              description: '所要日数',
            },
            dueDate: {
              type: 'string',
              description: '期限/終了日（ISO 8601形式）',
            },
            listId: {
              type: 'string',
              description: 'タスクを追加するリストのID',
            },
          },
          required: ['title'],
        },
      },
    },
    required: ['tasks'],
  },
};

/**
 * create_task handler
 */
export const createTaskHandler: ToolHandler<CreateTaskArgs, CreateTaskResult> = async (
  args,
  context
) => {
  const { title, description, priority, startDate, durationDays, dueDate, isDueDateFixed, listId: argsListId, dependsOnTaskIds } = args;
  const { projectId, userId, listId: contextListId } = context;

  // Use listId from args if provided, otherwise fall back to context
  const listId = argsListId || contextListId;

  if (!listId) {
    throw new Error('listId is required for task creation. Please specify a listId or use get_lists to find available lists.');
  }

  const warnings: string[] = [];
  let suggestedStartDate: string | undefined;

  // Fetch all tasks for validation and dependency calculations
  let allTasks: import('@/types').Task[] = [];
  if (dependsOnTaskIds && dependsOnTaskIds.length > 0) {
    allTasks = await getProjectTasks(projectId);
  }

  // Validate date fields and dependencies
  const validation = validateTask({
    startDate,
    dueDate,
    durationDays,
    isDueDateFixed,
    dependsOnTaskIds,
    allTasks,
  });

  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
  warnings.push(...validation.warnings);

  // Calculate dates
  let calculatedStartDate: Date | null = startDate ? new Date(startDate) : null;
  let calculatedDueDate: Date | null = dueDate ? new Date(dueDate) : null;

  // Auto-suggest start date based on dependencies if not provided
  if (!startDate && dependsOnTaskIds && dependsOnTaskIds.length > 0) {
    // Create a temporary task object for calculation
    const tempTask = {
      id: 'temp',
      dependsOnTaskIds,
    } as import('@/types').Task;

    const effectiveStart = calculateEffectiveStartDate(tempTask, allTasks);
    if (effectiveStart) {
      suggestedStartDate = effectiveStart.toISOString().split('T')[0];
      calculatedStartDate = effectiveStart;
      warnings.push(`依存タスクに基づき、開始日を${suggestedStartDate}に自動設定しました。`);
    }
  }

  // If durationDays is provided with startDate, calculate dueDate
  if (durationDays && calculatedStartDate) {
    calculatedDueDate = new Date(calculatedStartDate);
    calculatedDueDate.setDate(calculatedStartDate.getDate() + durationDays - 1); // -1 because start day counts as day 1
  }

  // Check for deadline overdue when isDueDateFixed is true
  if (isDueDateFixed && calculatedDueDate && calculatedStartDate && durationDays) {
    const expectedEnd = new Date(calculatedStartDate);
    expectedEnd.setDate(calculatedStartDate.getDate() + durationDays - 1);
    const overdueWarning = checkDeadlineOverdue(expectedEnd, calculatedDueDate);
    if (overdueWarning) {
      warnings.push(overdueWarning);
    }
  }

  const taskId = await createTask(projectId, {
    listId,
    title,
    description: description || '',
    order: Date.now(), // Use timestamp for ordering new tasks at the end
    ...(args.assigneeIds !== undefined ? { assigneeIds: args.assigneeIds } : {}),
    aiSuggested: true,
    labelIds: [],
    tagIds: [],
    dependsOnTaskIds: dependsOnTaskIds || [],
    priority: priority || null,
    startDate: calculatedStartDate,
    dueDate: calculatedDueDate,
    durationDays: durationDays || null,
    isDueDateFixed: isDueDateFixed ?? false, // Default to false (duration優先)
    isCompleted: false,
    completedAt: null,
    isAbandoned: false,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    createdBy: userId,
  });

  return {
    taskId,
    title,
    success: true,
    suggestedStartDate,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
};

/**
 * create_tasks handler (multiple tasks)
 */
export const createTasksHandler: ToolHandler<CreateTasksArgs, CreateTasksResult> = async (
  args,
  context
) => {
  const { tasks } = args;
  const results: CreateTaskResult[] = [];

  for (const taskArgs of tasks) {
    try {
      const result = await createTaskHandler(taskArgs, context);
      results.push(result);
    } catch {
      results.push({
        taskId: '',
        title: taskArgs.title,
        success: false,
      });
    }
  }

  return {
    tasks: results,
    totalCreated: results.filter((r) => r.success).length,
  };
};
