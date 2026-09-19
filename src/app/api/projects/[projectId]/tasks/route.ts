import { TaskDateValidationError } from '@/lib/task/dateValidation';
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import {
  createProjectTask,
  listProjectTasks,
  type CreateProjectTaskInput,
} from '@/lib/firebase/admin-projects';
import type { Priority } from '@/types';

interface RouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateRequest(request.headers.get('Authorization'));
    const { projectId } = await context.params;

    await getProjectAccess(
      auth.userId,
      projectId,
      auth.permissions,
      auth.projectIds,
      'tasks:read'
    );

    const tasks = await listProjectTasks(projectId);
    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const status = message.includes('Authorization') || message === 'Invalid API token' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
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

function parseCreateTaskBody(body: unknown): CreateProjectTaskInput {
  if (typeof body !== 'object' || body === null) {
    throw new Error('INVALID_BODY');
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    throw new Error('TITLE_REQUIRED');
  }

  if (typeof payload.listId !== 'string' || !payload.listId) {
    throw new Error('LIST_REQUIRED');
  }

  if (payload.durationDays !== undefined && payload.durationDays !== null && typeof payload.durationDays !== 'number') {
    throw new Error('INVALID_DURATIONDAYS');
  }

  if (payload.isDueDateFixed !== undefined && typeof payload.isDueDateFixed !== 'boolean') {
    throw new Error('INVALID_ISDUEDATEFIXED');
  }

  return {
    listId: payload.listId,
    title: payload.title.trim(),
    description: typeof payload.description === 'string' ? payload.description : undefined,
    assigneeIds: parseStringArray(payload.assigneeIds, 'assigneeIds'),
    labelIds: parseStringArray(payload.labelIds, 'labelIds'),
    tagIds: parseStringArray(payload.tagIds, 'tagIds'),
    dependsOnTaskIds: parseStringArray(payload.dependsOnTaskIds, 'dependsOnTaskIds'),
    priority: parsePriority(payload.priority),
    startDate: parseOptionalDateString(payload.startDate, 'startDate'),
    dueDate: parseOptionalDateString(payload.dueDate, 'dueDate'),
    durationDays: typeof payload.durationDays === 'number' ? payload.durationDays : undefined,
    isDueDateFixed: payload.isDueDateFixed,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateRequest(request.headers.get('Authorization'));
    const { projectId } = await context.params;

    await getProjectAccess(
      auth.userId,
      projectId,
      auth.permissions,
      auth.projectIds,
      'tasks:write'
    );

    const body = await request.json();
    const taskInput = parseCreateTaskBody(body);
    const result = await createProjectTask(projectId, auth.userId, taskInput);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TaskDateValidationError) return NextResponse.json({ error: error.message }, { status: 422 });
    const message = error instanceof Error ? error.message : 'Internal server error';

    if (message === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (message === 'NOT_FOUND') {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    if (message === 'INVALID_LIST') {
      return NextResponse.json({ error: 'List not found in project' }, { status: 400 });
    }

    if (
      message === 'INVALID_BODY' ||
      message === 'TITLE_REQUIRED' ||
      message === 'LIST_REQUIRED' ||
      message.startsWith('INVALID_')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const status = message.includes('Authorization') || message === 'Invalid API token' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
