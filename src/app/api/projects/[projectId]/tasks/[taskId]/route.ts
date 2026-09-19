import { TaskDateValidationError } from '@/lib/task/dateValidation';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import {
  archiveProjectTask,
  updateProjectTask,
  type UpdateProjectTaskInput,
} from '@/lib/firebase/admin-projects';
import type { Priority } from '@/types';
import { actOnDescription } from '@/lib/ai/descriptionOperations';
import { SecretaryError } from '@/lib/secretary/engine';

interface RouteContext {
  params: Promise<{
    projectId: string;
    taskId: string;
  }>;
}

function hasOwn(payload: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function parsePriority(value: unknown): Priority | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value === 'high' || value === 'medium' || value === 'low') {
    return value;
  }

  throw new Error('INVALID_PRIORITY');
}

function parseStringArray(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}`);
  }

  return value;
}

function parseOptionalDateString(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value as null | undefined;
  }

  if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
    throw new Error(`INVALID_${fieldName.toUpperCase()}`);
  }

  return value;
}

function parseUpdateTaskBody(body: unknown): UpdateProjectTaskInput {
  if (typeof body !== 'object' || body === null) {
    throw new Error('INVALID_BODY');
  }

  const payload = body as Record<string, unknown>;
  const updateInput: UpdateProjectTaskInput = {};

  if (hasOwn(payload, 'listId')) {
    if (typeof payload.listId !== 'string' || !payload.listId) {
      throw new Error('INVALID_LISTID');
    }
    updateInput.listId = payload.listId;
  }
  if (hasOwn(payload, 'title')) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) {
      throw new Error('INVALID_TITLE');
    }
    updateInput.title = payload.title.trim();
  }
  if (hasOwn(payload, 'description')) {
    if (typeof payload.description !== 'string') {
      throw new Error('INVALID_DESCRIPTION');
    }
    updateInput.description = payload.description;
  }
  if (hasOwn(payload, 'assigneeIds')) {
    updateInput.assigneeIds = parseStringArray(payload.assigneeIds, 'assigneeIds');
  }
  if (hasOwn(payload, 'labelIds')) {
    updateInput.labelIds = parseStringArray(payload.labelIds, 'labelIds');
  }
  if (hasOwn(payload, 'tagIds')) {
    updateInput.tagIds = parseStringArray(payload.tagIds, 'tagIds');
  }
  if (hasOwn(payload, 'dependsOnTaskIds')) {
    updateInput.dependsOnTaskIds = parseStringArray(payload.dependsOnTaskIds, 'dependsOnTaskIds');
  }
  if (hasOwn(payload, 'priority')) {
    updateInput.priority = parsePriority(payload.priority);
  }
  if (hasOwn(payload, 'startDate')) {
    updateInput.startDate = parseOptionalDateString(payload.startDate, 'startDate');
  }
  if (hasOwn(payload, 'dueDate')) {
    updateInput.dueDate = parseOptionalDateString(payload.dueDate, 'dueDate');
  }
  if (hasOwn(payload, 'durationDays')) {
    if (payload.durationDays !== null && typeof payload.durationDays !== 'number') {
      throw new Error('INVALID_DURATIONDAYS');
    }
    updateInput.durationDays = payload.durationDays as number | null;
  }
  if (hasOwn(payload, 'isDueDateFixed')) {
    if (typeof payload.isDueDateFixed !== 'boolean') {
      throw new Error('INVALID_ISDUEDATEFIXED');
    }
    updateInput.isDueDateFixed = payload.isDueDateFixed;
  }
  if (hasOwn(payload, 'isCompleted')) {
    if (typeof payload.isCompleted !== 'boolean') {
      throw new Error('INVALID_ISCOMPLETED');
    }
    updateInput.isCompleted = payload.isCompleted;
  }

  if (Object.keys(updateInput).length === 0) {
    throw new Error('NO_UPDATES');
  }

  return updateInput;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateRequest(request.headers.get('Authorization'));
    const { projectId, taskId } = await context.params;

    await getProjectAccess(
      auth.userId,
      projectId,
      auth.permissions,
      auth.projectIds,
      'tasks:write'
    );

    const body = await request.json();
    if (body && typeof body === 'object' && 'aiDescriptionOperation' in body) {
      const op = body.aiDescriptionOperation;
      if (Object.keys(body).length !== 1 || !op || typeof op !== 'object' || Object.keys(op).some(k => !['operationId', 'action'].includes(k))) throw new SecretaryError('INVALID', '説明以外の変更は実行できません。');
      return NextResponse.json(await actOnDescription(auth.userId, projectId, taskId, op.operationId, op.action), { headers: { 'Cache-Control': 'no-store' } });
    }
    const updateInput = parseUpdateTaskBody(body);
    const result = await updateProjectTask(projectId, taskId, updateInput);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TaskDateValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof SecretaryError) return NextResponse.json({ error: error.message }, { status: ({ INVALID: 422, CONFLICT: 409, FORBIDDEN: 403, INCOMPLETE: 503, AI_UNAVAILABLE: 503 })[error.code] });
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (message === 'INVALID_LIST') {
      return NextResponse.json({ error: 'List not found in project' }, { status: 400 });
    }

    if (
      message === 'INVALID_BODY' ||
      message === 'NO_UPDATES' ||
      message.startsWith('INVALID_')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = message.includes('Authorization') || message === 'Invalid API token' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateRequest(request.headers.get('Authorization'));
    const { projectId, taskId } = await context.params;

    await getProjectAccess(
      auth.userId,
      projectId,
      auth.permissions,
      auth.projectIds,
      'tasks:write'
    );

    const result = await archiveProjectTask(projectId, taskId, auth.userId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (message === 'ALREADY_ARCHIVED') {
      return NextResponse.json({ error: 'Task is already archived' }, { status: 409 });
    }

    const status = message.includes('Authorization') || message === 'Invalid API token' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
