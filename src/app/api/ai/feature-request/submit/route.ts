import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken, getAdminDb } from '@/lib/firebase/admin';
import { getProjectAccess } from '@/lib/auth/projectAccess';
import { createProjectTask, listProjectLists } from '@/lib/firebase/admin-projects';
import { REQUEST_LIST, REQUEST_PROJECT, parseRequestTurns, requestRecord } from '@/lib/ai/featureRequest/types';
import { parseAnnotationReferences, annotationRecord } from '@/lib/ai/featureRequest/annotations';
export const runtime = 'nodejs';
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: NextRequest) {
  let uid: string;
  try { uid = (await verifyAuthToken(request.headers.get('Authorization'))).uid; } catch { return json({ error: 'ログインを確認してください。' }, 401); }
  let body, turns, annotations;
  try {
    const raw = await request.text(); if (raw.length > 80000) throw new Error(); body = JSON.parse(raw);
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !['projectId', 'requestId', 'title', 'description', 'turns', 'annotations'].includes(key)) || typeof body.projectId !== 'string' || !/^[\w-]{1,100}$/.test(body.projectId) || typeof body.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.requestId) || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 32 || typeof body.description !== 'string' || !body.description.trim() || body.description.length > 6000) throw new Error();
    turns = parseRequestTurns(body.turns); annotations = parseAnnotationReferences(body.annotations);
  } catch { return json({ error: '要望の内容と長さを確認してください。' }, 400); }
  try {
    await getProjectAccess(uid, body.projectId, null, null, 'tasks:write');
    const project = await getAdminDb().doc(`projects/${body.projectId}`).get();
    if (project.data()?.name?.trim() !== REQUEST_PROJECT || project.data()?.isArchived) return json({ error: '送信先を確認してください。' }, 403);
    const lists = (await listProjectLists(body.projectId)).filter(list => list.name.trim() === REQUEST_LIST);
    if (lists.length !== 1) return json({ error: '要望リストを一つに特定できません。' }, 409);
    const description = [body.description.trim(), `---\n要望の原文・聞き取り\n${requestRecord(turns)}`, annotations.length ? `---\n${annotationRecord(annotations)}` : ''].filter(Boolean).join('\n\n');
    const input = { title: body.title.trim(), description, listId: lists[0].id };
    const taskId = `request-${createHash('sha256').update(`${uid}:${body.requestId}`).digest('hex')}`;
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const result = await createProjectTask(body.projectId, uid, input, { taskId, fingerprint });
    return json(result, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'FORBIDDEN' || message === 'NOT_FOUND') return json({ error: '送信先への権限を確認してください。' }, 403);
    if (message === 'REQUEST_CONFLICT') return json({ error: '受付済みの内容と異なります。' }, 409);
    return json({ error: '登録を確認できませんでした。同じ受付で再送できます。' }, 503);
  }
}
