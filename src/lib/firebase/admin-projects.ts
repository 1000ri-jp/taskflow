import { updateTaskWithRecurrence } from '@/lib/task/recurrenceRepository';
import { assertTaskDates, hasTaskDateChange } from '@/lib/task/dateValidation';
import type { CommentAttachment, Priority, Task } from '@/types';
import { checkDeadlineOverdue, validateTask } from '@/lib/ai/tools/validation';
import { calculateEffectiveStartDate, recalculateDates } from '@/lib/utils/task';
import { getAdminDb } from './admin';
import { resolveTaskAssignees } from '@/lib/task/assigneeDefaults';

interface AdminProject {
  id: string;
  name: string;
  isArchived: boolean;
  memberIds: string[];
  updatedAt: Date | null;
}

interface AdminTask {
  id: string;
  listId: string;
  priority: 'high' | 'medium' | 'low' | null;
  isCompleted: boolean;
  dueDate: Date | null;
}

interface AdminList {
  id: string;
  name: string;
  order: number;
  defaultAssigneeId?: string | null;
  autoCompleteOnEnter?: boolean;
  autoSetStartDateOnEnter?: boolean;
}

function omitUndefinedFields<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as T;
}

export interface ProjectStatusSummary {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  highPriorityTasks: number;
}

export interface ProjectStatusListSummary {
  id: string;
  name: string;
  taskCount: number;
  completedCount: number;
}

export interface ProjectStatusResult {
  project: {
    id: string;
    name: string;
    isArchived: boolean;
    updatedAt: string | null;
  };
  summary: ProjectStatusSummary;
  lists: ProjectStatusListSummary[];
}

export interface ProjectListItem {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  iconUrl?: string;
  headerImageUrl?: string;
  isArchived: boolean;
  updatedAt: string | null;
}

export interface ProjectTaskItem {
  id: string;
  listId: string;
  title: string;
  description: string;
  assigneeIds: string[];
  labelIds: string[];
  tagIds: string[];
  priority: 'high' | 'medium' | 'low' | null;
  startDate: string | null;
  dueDate: string | null;
  isCompleted: boolean;
  updatedAt: string | null;
}

export interface ProjectTaskCommentItem {
  id: string;
  taskId: string;
  content: string;
  authorId: string;
  authorLabel?: string;
  authorIcon?: string | null;
  mentions: string[];
  attachments: CommentAttachment[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProjectListSummaryItem {
  id: string;
  name: string;
  color: string;
  order: number;
  autoCompleteOnEnter: boolean;
  autoUncompleteOnExit: boolean;
  autoSetStartDateOnEnter: boolean;
}

export interface CreateProjectTaskInput {
  listId: string;
  title: string;
  description?: string;
  assigneeIds?: string[];
  labelIds?: string[];
  tagIds?: string[];
  dependsOnTaskIds?: string[];
  priority?: Priority | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number | null;
  isDueDateFixed?: boolean;
}

export interface UpdateProjectTaskInput {
  listId?: string;
  title?: string;
  description?: string;
  assigneeIds?: string[];
  labelIds?: string[];
  tagIds?: string[];
  dependsOnTaskIds?: string[];
  priority?: Priority | null;
  startDate?: string | null;
  dueDate?: string | null;
  durationDays?: number | null;
  isDueDateFixed?: boolean;
  isCompleted?: boolean;
}

interface CreateOrUpdateResult {
  task: ProjectTaskItem;
  warnings?: string[];
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate();
  }

  return null;
}

function toIsoString(value: unknown): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function mapTaskDataToTask(projectId: string, taskId: string, data: Record<string, unknown>): Task {
  return {
    id: taskId,
    projectId,
    listId: typeof data.listId === 'string' ? data.listId : '',
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : '',
    order: typeof data.order === 'number' ? data.order : 0,
    ...(data.taskKind === 'review_request' || data.taskKind === 'decision' ? { taskKind: data.taskKind } : {}),
    assigneeIds: Array.isArray(data.assigneeIds) ? data.assigneeIds : [],
    labelIds: Array.isArray(data.labelIds) ? data.labelIds : [],
    tagIds: Array.isArray(data.tagIds) ? data.tagIds : [],
    dependsOnTaskIds: Array.isArray(data.dependsOnTaskIds) ? data.dependsOnTaskIds : [],
    priority: data.priority === 'high' || data.priority === 'medium' || data.priority === 'low' ? data.priority : null,
    startDate: toDate(data.startDate),
    dueDate: toDate(data.dueDate),
    durationDays: typeof data.durationDays === 'number' ? data.durationDays : null,
    isDueDateFixed: data.isDueDateFixed === true,
    isCompleted: data.isCompleted === true,
    completedAt: toDate(data.completedAt),
    isAbandoned: data.isAbandoned === true,
    isArchived: data.isArchived === true,
    archivedAt: toDate(data.archivedAt),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : null,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdAt: toDate(data.createdAt) ?? new Date(),
    updatedAt: toDate(data.updatedAt) ?? new Date(),
  };
}

function mapTaskToApiItem(task: Task): ProjectTaskItem {
  return {
    id: task.id,
    listId: task.listId,
    title: task.title,
    description: task.description,
    assigneeIds: task.assigneeIds,
    labelIds: task.labelIds,
    tagIds: task.tagIds,
    priority: task.priority,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    isCompleted: task.isCompleted,
    updatedAt: task.updatedAt ? task.updatedAt.toISOString() : null,
  };
}

function mapCommentToApiItem(
  taskId: string,
  commentId: string,
  data: Record<string, unknown>
): ProjectTaskCommentItem {
  return {
    id: commentId,
    taskId,
    content: typeof data.content === 'string' ? data.content : '',
    authorId: typeof data.authorId === 'string' ? data.authorId : '',
    authorLabel: typeof data.authorLabel === 'string' ? data.authorLabel : undefined,
    authorIcon: typeof data.authorIcon === 'string' ? data.authorIcon : null,
    mentions:
      Array.isArray(data.mentions) && data.mentions.every((item) => typeof item === 'string')
        ? data.mentions
        : [],
    attachments:
      Array.isArray(data.attachments) &&
      data.attachments.every(
        (item) =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.id === 'string' &&
          typeof item.name === 'string' &&
          typeof item.url === 'string' &&
          typeof item.type === 'string' &&
          typeof item.size === 'number'
      )
        ? (data.attachments as CommentAttachment[])
        : [],
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

async function getProjectListsInternal(projectId: string): Promise<AdminList[]> {
  const db = getAdminDb();
  const snapshot = await db.collection('projects').doc(projectId).collection('lists').orderBy('order', 'asc').get();

  return snapshot.docs.map((listDoc) => {
    const data = listDoc.data();
    return {
      id: listDoc.id,
      name: typeof data.name === 'string' ? data.name : '',
      order: typeof data.order === 'number' ? data.order : 0,
      defaultAssigneeId: typeof data.defaultAssigneeId === 'string' ? data.defaultAssigneeId : null,
      autoCompleteOnEnter: data.autoCompleteOnEnter === true,
      autoSetStartDateOnEnter: data.autoSetStartDateOnEnter === true,
    };
  });
}

export async function listProjectLists(projectId: string): Promise<ProjectListSummaryItem[]> {
  const db = getAdminDb();
  const snapshot = await db.collection('projects').doc(projectId).collection('lists').orderBy('order', 'asc').get();

  return snapshot.docs.map((listDoc) => {
    const data = listDoc.data();
    return {
      id: listDoc.id,
      name: typeof data.name === 'string' ? data.name : '',
      color: typeof data.color === 'string' ? data.color : '',
      order: typeof data.order === 'number' ? data.order : 0,
      autoCompleteOnEnter: data.autoCompleteOnEnter === true,
      autoUncompleteOnExit: data.autoUncompleteOnExit === true,
      autoSetStartDateOnEnter: data.autoSetStartDateOnEnter === true,
    };
  });
}

async function getProjectTasksInternal(projectId: string): Promise<Task[]> {
  const db = getAdminDb();
  const snapshot = await db.collection('projects').doc(projectId).collection('tasks').get();

  return snapshot.docs
    .map((taskDoc) => mapTaskDataToTask(projectId, taskDoc.id, taskDoc.data()))
    .filter((task) => !task.isArchived);
}

async function getProjectTaskInternal(projectId: string, taskId: string): Promise<Task | null> {
  const db = getAdminDb();
  const snapshot = await db.collection('projects').doc(projectId).collection('tasks').doc(taskId).get();

  if (!snapshot.exists) {
    return null;
  }

  return mapTaskDataToTask(projectId, snapshot.id, snapshot.data() as Record<string, unknown>);
}

export async function listUserProjects(userId: string, allowedProjectIds: string[] | null = null): Promise<ProjectListItem[]> {
  const db = getAdminDb();
  const snapshot = await db
    .collection('projects')
    .where('memberIds', 'array-contains', userId)
    .where('isArchived', '==', false)
    .get();

  return snapshot.docs
    .filter((doc) => allowedProjectIds === null || allowedProjectIds.includes(doc.id))
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: typeof data.name === 'string' ? data.name : '',
        description: typeof data.description === 'string' ? data.description : '',
        color: typeof data.color === 'string' ? data.color : '',
        icon: typeof data.icon === 'string' ? data.icon : '',
        iconUrl: typeof data.iconUrl === 'string' && data.iconUrl ? data.iconUrl : undefined,
        headerImageUrl:
          typeof data.headerImageUrl === 'string' && data.headerImageUrl ? data.headerImageUrl : undefined,
        isArchived: data.isArchived === true,
        updatedAt: toIsoString(data.updatedAt),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export async function getProjectStatus(projectId: string, userId: string): Promise<ProjectStatusResult | null> {
  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(projectId);
  const projectSnapshot = await projectRef.get();

  if (!projectSnapshot.exists) {
    return null;
  }

  const projectData = projectSnapshot.data();
  if (!projectData) {
    return null;
  }

  const project: AdminProject = {
    id: projectSnapshot.id,
    name: typeof projectData.name === 'string' ? projectData.name : '',
    isArchived: projectData.isArchived === true,
    memberIds: Array.isArray(projectData.memberIds) ? projectData.memberIds : [],
    updatedAt: toDate(projectData.updatedAt),
  };

  if (!project.memberIds.includes(userId)) {
    throw new Error('FORBIDDEN');
  }

  const [allTasks, lists] = await Promise.all([
    getProjectTasksInternal(projectId),
    getProjectListsInternal(projectId),
  ]);

  const tasks: AdminTask[] = allTasks.map((task) => ({
    id: task.id,
    listId: task.listId,
    priority: task.priority,
    isCompleted: task.isCompleted,
    dueDate: task.dueDate,
  }));

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const summary: ProjectStatusSummary = {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((task) => task.isCompleted).length,
    overdueTasks: tasks.filter((task) => !task.isCompleted && task.dueDate !== null && task.dueDate < today).length,
    highPriorityTasks: tasks.filter((task) => !task.isCompleted && task.priority === 'high').length,
  };

  const listSummaries: ProjectStatusListSummary[] = lists
    .sort((a, b) => a.order - b.order)
    .map((list) => {
      const listTasks = tasks.filter((task) => task.listId === list.id);
      return {
        id: list.id,
        name: list.name,
        taskCount: listTasks.length,
        completedCount: listTasks.filter((task) => task.isCompleted).length,
      };
    });

  return {
    project: {
      id: project.id,
      name: project.name,
      isArchived: project.isArchived,
      updatedAt: project.updatedAt ? project.updatedAt.toISOString() : null,
    },
    summary,
    lists: listSummaries,
  };
}

export async function listProjectTasks(projectId: string): Promise<ProjectTaskItem[]> {
  const tasks = await getProjectTasksInternal(projectId);
  return tasks.map(mapTaskToApiItem);
}

export async function createProjectTask(
  projectId: string,
  userId: string,
  input: CreateProjectTaskInput,
  receipt?: { taskId: string; fingerprint: string }
): Promise<CreateOrUpdateResult> {
  assertTaskDates(input);
  const db = getAdminDb();
  const [lists, allTasks, projectSnapshot] = await Promise.all([
    getProjectListsInternal(projectId),
    getProjectTasksInternal(projectId),
    db.collection('projects').doc(projectId).get(),
  ]);
  if (!projectSnapshot.exists) throw new Error('NOT_FOUND');
  const project = projectSnapshot.data()!;
  if (project.isArchived) throw new Error('INVALID_ARCHIVED_PROJECT');
  const memberIds: string[] = Array.isArray(project.memberIds) ? project.memberIds : [];
  const targetList = lists.find((list) => list.id === input.listId);
  if (!targetList) {
    throw new Error('INVALID_LIST');
  }

  const assigneeIds = resolveTaskAssignees({
    explicit: input.assigneeIds, defaultAssigneeId: project.defaultAssigneeId,
    listDefaultAssigneeId: targetList.defaultAssigneeId, memberIds,
  });
  if (assigneeIds.some(id => !memberIds.includes(id))) throw new Error('INVALID_ASSIGNEE');

  const warnings: string[] = [];
  const dependsOnTaskIds = input.dependsOnTaskIds ?? [];
  const validation = validateTask({
    startDate: input.startDate,
    dueDate: input.dueDate,
    durationDays: input.durationDays,
    isDueDateFixed: input.isDueDateFixed,
    dependsOnTaskIds,
    allTasks,
  });

  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
  warnings.push(...validation.warnings);

  let calculatedStartDate = input.startDate ? new Date(input.startDate) : null;
  let calculatedDueDate = input.dueDate ? new Date(input.dueDate) : null;

  if (!input.startDate && dependsOnTaskIds.length > 0) {
    const effectiveStartDate = calculateEffectiveStartDate(
      { id: 'temp', dependsOnTaskIds } as Task,
      allTasks
    );

    if (effectiveStartDate) {
      calculatedStartDate = effectiveStartDate;
      warnings.push(`依存タスクに基づき、開始日を${effectiveStartDate.toISOString().split('T')[0]}に自動設定しました。`);
    }
  }

  if (input.durationDays && calculatedStartDate) {
    calculatedDueDate = new Date(calculatedStartDate);
    calculatedDueDate.setDate(calculatedStartDate.getDate() + input.durationDays - 1);
  }

  if (input.isDueDateFixed && calculatedDueDate && calculatedStartDate && input.durationDays) {
    const expectedEnd = new Date(calculatedStartDate);
    expectedEnd.setDate(calculatedStartDate.getDate() + input.durationDays - 1);
    const overdueWarning = checkDeadlineOverdue(expectedEnd, calculatedDueDate);
    if (overdueWarning) {
      warnings.push(overdueWarning);
    }
  }

  const tasksInList = allTasks.filter((task) => task.listId === input.listId);
  const maxOrder = Math.max(...tasksInList.map((task) => task.order), -1);
  const shouldAutoComplete = targetList.autoCompleteOnEnter === true;
  const now = new Date();

  // Set start date on enter (only if not already set)
  if (targetList.autoSetStartDateOnEnter === true && !calculatedStartDate) {
    calculatedStartDate = now;
  }

  const taskData: Omit<Task, 'id' | 'projectId'> = {
    listId: input.listId,
    title: input.title,
    description: input.description ?? '',
    order: maxOrder + 1,
    assigneeIds,
    labelIds: input.labelIds ?? [],
    tagIds: input.tagIds ?? [],
    dependsOnTaskIds,
    priority: input.priority ?? null,
    startDate: calculatedStartDate,
    dueDate: calculatedDueDate,
    durationDays: input.durationDays ?? null,
    isDueDateFixed: input.isDueDateFixed ?? false,
    isCompleted: shouldAutoComplete,
    completedAt: shouldAutoComplete ? now : null,
    isAbandoned: false,
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
  };

  assertTaskDates(taskData);
  const tasksRef = db.collection('projects').doc(projectId).collection('tasks');
  const taskRef = receipt ? tasksRef.doc(receipt.taskId) : await tasksRef.add(taskData);
  if (receipt) {
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(taskRef);
      if (existing.exists) {
        if (existing.data()?.createdBy !== userId || existing.data()?.requestFingerprint !== receipt.fingerprint) throw new Error('REQUEST_CONFLICT');
        return;
      }
      transaction.create(taskRef, { ...taskData, requestFingerprint: receipt.fingerprint });
    });
  }
  const task = await getProjectTaskInternal(projectId, taskRef.id);

  if (!task) {
    throw new Error('TASK_CREATE_FAILED');
  }

  return {
    task: mapTaskToApiItem(task),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function updateProjectTask(
  projectId: string,
  taskId: string,
  input: UpdateProjectTaskInput
): Promise<CreateOrUpdateResult> {
  const db = getAdminDb();
  const [existingTask, allTasks, lists] = await Promise.all([
    getProjectTaskInternal(projectId, taskId),
    getProjectTasksInternal(projectId),
    getProjectListsInternal(projectId),
  ]);

  if (!existingTask || existingTask.isArchived) {
    throw new Error('NOT_FOUND');
  }

  if(existingTask.parentTaskId && Object.keys(input).some(k=>!['title','assigneeIds','dueDate','isCompleted','listId'].includes(k)))throw new Error('INVALID_SUBTASK_FIELDS');
  if (existingTask.taskKind === 'review_request' && input.isCompleted !== undefined) throw new Error('REVIEW_RESPONSE_REQUIRED');

  if (input.listId !== undefined && !lists.some((list) => list.id === input.listId)) {
    throw new Error('INVALID_LIST');
  }

  const warnings: string[] = [];
  const nextStartDate = input.startDate !== undefined ? input.startDate : existingTask.startDate?.toISOString() ?? null;
  const nextDueDate = input.dueDate !== undefined ? input.dueDate : existingTask.dueDate?.toISOString() ?? null;
  if (hasTaskDateChange(input)) assertTaskDates({ startDate: nextStartDate, dueDate: nextDueDate });
  const nextDurationDays = input.durationDays !== undefined ? input.durationDays : existingTask.durationDays;
  const nextIsDueDateFixed = input.isDueDateFixed !== undefined ? input.isDueDateFixed : existingTask.isDueDateFixed;
  const nextDependsOnTaskIds = input.dependsOnTaskIds !== undefined ? input.dependsOnTaskIds : existingTask.dependsOnTaskIds;

  const validation = validateTask({
    taskId,
    startDate: nextStartDate,
    dueDate: nextDueDate,
    durationDays: nextDurationDays,
    isDueDateFixed: nextIsDueDateFixed,
    dependsOnTaskIds: nextDependsOnTaskIds,
    allTasks,
  });

  if (!validation.valid) {
    throw new Error(validation.errors.join('\n'));
  }
  warnings.push(...validation.warnings);

  const updateData: Record<string, unknown> = {};
  const hasDateChanges =
    input.startDate !== undefined ||
    input.dueDate !== undefined ||
    input.durationDays !== undefined ||
    input.isDueDateFixed !== undefined;

  if (input.title !== undefined) {
    updateData.title = input.title;
  }
  if (input.description !== undefined) {
    updateData.description = input.description;
  }
  if (input.priority !== undefined) {
    updateData.priority = input.priority;
  }
  if (input.listId !== undefined) {
    updateData.listId = input.listId;
  }
  if (input.assigneeIds !== undefined) {
    updateData.assigneeIds = input.assigneeIds;
  }
  if (input.labelIds !== undefined) {
    updateData.labelIds = input.labelIds;
  }
  if (input.tagIds !== undefined) {
    updateData.tagIds = input.tagIds;
  }
  if (input.dependsOnTaskIds !== undefined) {
    updateData.dependsOnTaskIds = input.dependsOnTaskIds;
  }

  if (hasDateChanges) {
    const recalculated = recalculateDates(existingTask, {
      startDate: input.startDate !== undefined ? (input.startDate ? new Date(input.startDate) : null) : undefined,
      dueDate: input.dueDate !== undefined ? (input.dueDate ? new Date(input.dueDate) : null) : undefined,
      durationDays: input.durationDays,
      isDueDateFixed: input.isDueDateFixed,
    });

    if (input.startDate !== undefined) {
      updateData.startDate = recalculated.startDate;
    }
    if (input.dueDate !== undefined || (input.durationDays !== undefined && !recalculated.isDueDateFixed)) {
      updateData.dueDate = recalculated.dueDate;
    }
    if (input.durationDays !== undefined || (input.dueDate !== undefined && existingTask.startDate)) {
      updateData.durationDays = recalculated.durationDays;
    }
    if (
      input.isDueDateFixed !== undefined ||
      input.dueDate !== undefined ||
      input.durationDays !== undefined
    ) {
      updateData.isDueDateFixed = recalculated.isDueDateFixed;
    }
  }

  if (input.isCompleted !== undefined) {
    updateData.isCompleted = input.isCompleted;
    updateData.completedAt = input.isCompleted ? new Date() : null;
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('NO_UPDATES');
  }

  updateData.updatedAt = new Date();
  const taskRef = db.collection('projects').doc(projectId).collection('tasks').doc(taskId);
  if (updateData.isCompleted === true) await updateTaskWithRecurrence(taskRef, updateData);
  else if (hasTaskDateChange(updateData)) await db.runTransaction(async tx => {
    const current = await tx.get(taskRef);
    if (!current.exists) throw new Error('NOT_FOUND');
    assertTaskDates({ ...current.data(), ...updateData });
    tx.update(taskRef, updateData);
  });
  else await taskRef.update(updateData);

  const task = await getProjectTaskInternal(projectId, taskId);
  if (!task) {
    throw new Error('NOT_FOUND');
  }

  return {
    task: mapTaskToApiItem(task),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function archiveProjectTask(
  projectId: string,
  taskId: string,
  userId: string
): Promise<{ task: ProjectTaskItem }> {
  const db = getAdminDb();
  const existingTask = await getProjectTaskInternal(projectId, taskId);

  if (!existingTask) {
    throw new Error('NOT_FOUND');
  }

  if (existingTask.isArchived) {
    throw new Error('ALREADY_ARCHIVED');
  }

  await db.collection('projects').doc(projectId).collection('tasks').doc(taskId).update({
    isArchived: true,
    archivedAt: new Date(),
    archivedBy: userId,
    updatedAt: new Date(),
  });

  const task = await getProjectTaskInternal(projectId, taskId);
  if (!task) {
    throw new Error('NOT_FOUND');
  }

  return {
    task: mapTaskToApiItem(task),
  };
}

export async function restoreProjectTask(
  projectId: string,
  taskId: string
): Promise<{ task: ProjectTaskItem }> {
  const db = getAdminDb();
  const existingTask = await getProjectTaskInternal(projectId, taskId);

  if (!existingTask) {
    throw new Error('NOT_FOUND');
  }

  if (!existingTask.isArchived) {
    throw new Error('NOT_ARCHIVED');
  }

  await db.collection('projects').doc(projectId).collection('tasks').doc(taskId).update({
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    updatedAt: new Date(),
  });

  const task = await getProjectTaskInternal(projectId, taskId);
  if (!task) {
    throw new Error('NOT_FOUND');
  }

  return {
    task: mapTaskToApiItem(task),
  };
}

export async function createProjectTaskComment(
  projectId: string,
  taskId: string,
  userId: string,
  input: {
    content: string;
    mentions?: string[];
    authorLabel?: string;
    authorIcon?: string | null;
  }
): Promise<{ comment: ProjectTaskCommentItem }> {
  const db = getAdminDb();
  const existingTask = await getProjectTaskInternal(projectId, taskId);

  if (!existingTask || existingTask.isArchived) {
    throw new Error('NOT_FOUND');
  }

  if(existingTask.parentTaskId)throw new Error('INVALID_SUBTASK_COMMENT_USE_PARENT');
  const now = new Date();
  const commentRef = await db
    .collection('projects')
    .doc(projectId)
    .collection('tasks')
    .doc(taskId)
    .collection('comments')
    .add(omitUndefinedFields({
      taskId,
      content: input.content,
      authorId: userId,
      authorLabel: input.authorLabel,
      authorIcon: input.authorIcon ?? null,
      mentions: input.mentions ?? [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    }));

  const commentSnapshot = await commentRef.get();
  if (!commentSnapshot.exists) {
    throw new Error('COMMENT_CREATE_FAILED');
  }

  return {
    comment: mapCommentToApiItem(taskId, commentSnapshot.id, commentSnapshot.data() as Record<string, unknown>),
  };
}
