import { NextRequest } from 'next/server';
import { getProvider, isValidProvider } from '@/lib/ai/providers';
import { AIContext, AIMessage, AIProviderType } from '@/types/ai';
import {
  getUserAIApiKey,
  getUserAIProjectAccessSettings,
  verifyAuthToken,
} from '@/lib/firebase/admin';
import { filterProjectsForAI, isAIProjectAllowed } from '@/lib/ai/projectAccess';
import { openDescriptionConversation, prepareDescription, readDescriptionConversation } from '@/lib/ai/descriptionOperations';
import { openReplyDraft, prepareReplyDraft, readReplyDraft, ReplyDraftSaveError } from '@/lib/ai/replyDrafts';
import type { DraftRequest } from '@/lib/ai/scopedConversationClient';
import { readAISupportInstructions } from '@/lib/ai/support/repository';
import { SecretaryError } from '@/lib/secretary/engine';

// Enable streaming for Vercel
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface ChatRequest {
  supportOverride?: string;
  draft?: DraftRequest;
  description?: { action: 'open' | 'read' | 'message'; conversationId: string; projectId?: string; taskId?: string; requestId?: string; content?: string };
  messages: AIMessage[];
  context: AIContext;
  provider: AIProviderType;
  model?: string;
  enableTools?: boolean;
  isToolResultContinuation?: boolean;
  projectId?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    let userId: string;
    try {
      const user = await verifyAuthToken(request.headers.get('Authorization'));
      userId = user.uid;
    } catch {
      return new Response(
        JSON.stringify({ error: '認証が必要です。再ログインしてください。' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = (await request.json()) as ChatRequest;
    if (body.draft) {
      try {
        const d = body.draft;
        if (body.description || typeof d !== 'object' || Object.keys(d).some(k => !['action', 'conversationId', 'sourceId', 'candidateId', 'signature', 'requestId', 'content'].includes(k))) throw new SecretaryError('INVALID', '返信案の依頼を確認してください。');
        let view;
        if (d.action === 'read') view = await readReplyDraft(userId, d.conversationId!);
        else if (isValidProvider(body.provider) && d.action === 'open') view = await openReplyDraft(userId, d.sourceId!, d.candidateId!, d.signature!, body.provider, body.model);
        else if (isValidProvider(body.provider) && d.action === 'message') view = await prepareReplyDraft(userId, d.conversationId!, d.requestId!, d.content!, body.provider, body.model);
        else throw new SecretaryError('INVALID', '返信案の操作を確認してください。');
        return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const status = error instanceof SecretaryError ? ({ INVALID: 422, CONFLICT: 409, FORBIDDEN: 403, INCOMPLETE: 503, AI_UNAVAILABLE: 503 })[error.code] : 503;
        return Response.json({ error: error instanceof SecretaryError ? error.message : '返信案の取得・保存に失敗しました。同じ依頼を再試行できます。', ...(error instanceof ReplyDraftSaveError ? { unsaved: error.draft } : {}) }, { status });
      }
    }
    if (body.description) {
      try {
        const d = body.description;
        if (typeof d !== 'object' || Object.keys(d).some(k => !['action', 'conversationId', 'projectId', 'taskId', 'requestId', 'content'].includes(k))) throw new SecretaryError('INVALID', '説明の依頼を確認してください。');
        let view;
        if (d.action === 'open') view = await openDescriptionConversation(userId, d.projectId!, d.taskId!, d.conversationId);
        else if (d.action === 'read') view = await readDescriptionConversation(userId, d.conversationId);
        else if (d.action === 'message' && isValidProvider(body.provider)) view = await prepareDescription(userId, d.conversationId, d.requestId!, d.content!, body.provider, body.model);
        else throw new SecretaryError('INVALID', '説明の操作を確認してください。');
        return Response.json(view, { headers: { 'Cache-Control': 'no-store' } });
      } catch (error) {
        const status = error instanceof SecretaryError ? ({ INVALID: 422, CONFLICT: 409, FORBIDDEN: 403, INCOMPLETE: 503, AI_UNAVAILABLE: 503 })[error.code] : 503;
        return Response.json({ error: error instanceof SecretaryError ? error.message : '説明の取得・保存に失敗しました。同じ依頼を再試行できます。' }, { status });
      }
    }
    const { messages, context, provider, model, enableTools, projectId } = body;

    // Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Messages are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!context) {
      return new Response(
        JSON.stringify({ error: 'Context is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!provider || !isValidProvider(provider)) {
      return new Response(
        JSON.stringify({ error: 'Valid provider is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (body.supportOverride !== undefined && (typeof body.supportOverride !== 'string' || body.supportOverride.length > 1000)) return Response.json({ error: '今回の手伝い方は1000文字以内で指定してください。' }, { status: 400 });

    // Retrieve API key from server-side storage
    const apiKey = await getUserAIApiKey(userId, provider);
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'APIキーが設定されていません。設定画面からAPIキーを設定してください。' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { allowedProjectIds } = await getUserAIProjectAccessSettings(userId);
    if (!isAIProjectAllowed(projectId, allowedProjectIds)) {
      return new Response(
        JSON.stringify({ error: 'このプロジェクトではAIアクセスが無効です。AI設定を確認してください。' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const filteredContext: AIContext = {
      ...context,
      projects: context.projects
        ? filterProjectsForAI(context.projects, allowedProjectIds)
        : context.projects,
    };

    const supportInstructions = await readAISupportInstructions(userId, body.supportOverride);

    // Get provider and create streaming response
    const aiProvider = getProvider(provider);

    // Use TransformStream for better streaming control
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();

    // Start processing in the background
    (async () => {
      try {
        // Send initial connection message
        await writer.write(encoder.encode(': connected\n\n'));

        const generator = aiProvider.sendMessage(
          messages,
          filteredContext,
          apiKey,
          model,
          { enableTools, projectId: projectId ?? undefined, supportInstructions }
        );

        for await (const chunk of generator) {
          if (chunk.type === 'text') {
            const data = `data: ${JSON.stringify({ type: 'text', content: chunk.content })}\n\n`;
            await writer.write(encoder.encode(data));
          } else if (chunk.type === 'tool_calls') {
            const data = `data: ${JSON.stringify({ type: 'tool_calls', toolCalls: chunk.toolCalls })}\n\n`;
            await writer.write(encoder.encode(data));
          } else if (chunk.type === 'done') {
            await writer.write(encoder.encode('data: [DONE]\n\n'));
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorData = `data: ${JSON.stringify({ error: errorMessage })}\n\n`;
        await writer.write(encoder.encode(errorData));
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, no-transform, must-revalidate',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Internal server error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
