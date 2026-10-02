import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { parseChangeLimit, TaskChangeError } from '@/lib/task/changeCursor';
import { listProjectTaskChanges } from '@/lib/task/changeRepository';

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const auth = await authenticateRequest(request.headers.get('Authorization'));
    const { projectId } = await context.params;
    await getProjectAccess(auth.userId, projectId, auth.permissions, auth.projectIds, 'tasks:read');
    const result = await listProjectTaskChanges(projectId, request.nextUrl.searchParams.get('cursor'), parseChangeLimit(request.nextUrl.searchParams.get('limit')));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof TaskChangeError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : 'Internal server error';
    if (message === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (message === 'NOT_FOUND') return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    const code = error instanceof Error && 'code' in error ? error.code : null;
    if (typeof code === 'string' && ['auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled'].includes(code)) {
      return NextResponse.json({ error: 'Invalid authentication token' }, { status: 401 });
    }
    const status = message.includes('Authorization') || message === 'Invalid API token' ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
