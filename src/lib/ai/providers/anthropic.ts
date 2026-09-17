import { taskResolutionPrompt } from '../taskResolutionPrompt';
import { AIContext, AIMessage, DEFAULT_MODELS } from '@/types/ai';
import { AIProvider, StreamChunk, SendMessageOptions } from './types';
import { getAnthropicTools } from '../tools';
import { ToolCall } from '../tools/types';

/**
 * Convert AIMessage array to Anthropic message format
 * Handles tool_use (assistant) and tool_result (user) messages
 */
function convertMessagesToAnthropic(messages: AIMessage[]): Array<{
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}> {
  const result: Array<{
    role: 'user' | 'assistant';
    content: string | Array<Record<string, unknown>>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // Check if this is an assistant message with tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const contentBlocks: Array<Record<string, unknown>> = [];

        // Add text content if present
        if (msg.content) {
          contentBlocks.push({ type: 'text', text: msg.content });
        }

        // Add tool_use blocks
        for (const toolCall of msg.toolCalls) {
          contentBlocks.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments,
          });
        }

        result.push({
          role: 'assistant',
          content: contentBlocks,
        });
      } else {
        // Regular text-only assistant message
        result.push({
          role: 'assistant',
          content: msg.content,
        });
      }
    } else if (msg.role === 'tool') {
      // Tool result message - becomes a user message with tool_result content
      result.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: msg.toolCallId,
            content: msg.content,
          },
        ],
      });
    } else {
      // User or system message
      result.push({
        role: 'user',
        content: msg.images?.length ? [{type:'text',text:msg.content},...msg.images.map(image=>({type:'image',source:{type:'base64',media_type:image.mimeType,data:image.data}}))] : msg.content,
      });
    }
  }

  return result;
}

export class AnthropicProvider implements AIProvider {
  name = 'anthropic' as const;

  async *sendMessage(
    messages: AIMessage[],
    context: AIContext,
    apiKey: string,
    model?: string,
    options?: SendMessageOptions
  ): AsyncGenerator<StreamChunk, void, unknown> {
    // Resolve projectId: explicit null = personal scope, undefined = use context
    const resolvedProjectId = options?.projectId !== undefined
      ? options.projectId
      : (context.project?.id || null);
    const systemPrompt = [options?.systemPrompt ?? buildCompanionSystemPrompt(context, options?.enableTools && !options?.isToolResultContinuation, resolvedProjectId), options?.supportInstructions].filter(Boolean).join('\n\n');
    const modelToUse = model || DEFAULT_MODELS.anthropic;

    // Convert messages to Anthropic format (handles tool_use and tool_result)
    const anthropicMessages = convertMessagesToAnthropic(messages);

    const requestBody: Record<string, unknown> = {
      model: modelToUse,
      max_tokens: options?.maxOutputTokens ?? 4096,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    };

    // Add tools if enabled - allow chained tool calls for multi-step operations
    if (options?.enableTools) {
      const tools = getAnthropicTools({ projectId: resolvedProjectId });
      requestBody.tools = tools;
      // Force tool use for better compliance
      requestBody.tool_choice = { type: 'auto' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API error');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    const toolCalls: ToolCall[] = [];
    let currentToolUse: { id: string; name: string; input: string } | null = null;
    let pending = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        pending += decoder.decode(value, { stream: true });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);

            try {
              const parsed = JSON.parse(data);

              // Handle text content
              if (parsed.type === 'content_block_delta') {
                if (parsed.delta?.type === 'text_delta') {
                  const text = parsed.delta?.text;
                  if (text) {
                    yield { type: 'text', content: text };
                  }
                } else if (parsed.delta?.type === 'input_json_delta') {
                  // Accumulate tool input
                  if (currentToolUse) {
                    currentToolUse.input += parsed.delta.partial_json || '';
                  }
                }
              }

              // Handle tool use start
              if (parsed.type === 'content_block_start') {
                if (parsed.content_block?.type === 'tool_use') {
                  currentToolUse = {
                    id: parsed.content_block.id,
                    name: parsed.content_block.name,
                    input: '',
                  };
                }
              }

              // Handle tool use end
              if (parsed.type === 'content_block_stop' && currentToolUse) {
                try {
                  toolCalls.push({
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    arguments: JSON.parse(currentToolUse.input || '{}'),
                  });
                } catch {
                  // Skip invalid JSON
                }
                currentToolUse = null;
              }

              // Handle message end
              if (parsed.type === 'message_stop') {
                if (toolCalls.length > 0) {
                  yield { type: 'tool_calls', toolCalls };
                }
                yield { type: 'done' };
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Unified companion system prompt builder for Anthropic.
 * Tool instructions placed FIRST for better Anthropic compliance.
 */
function getTimePeriodLabel(hour: number): string {
  if (hour >= 5 && hour <= 11) return '朝';
  if (hour >= 12 && hour <= 16) return '午後';
  if (hour >= 17 && hour <= 23) return '夕方';
  return '深夜';
}

function getTimePeriodInstructions(hour: number): string {
  if (hour >= 5 && hour <= 11) {
    return `- 元気で前向きな挨拶をしてください
- タスクの整理と優先順位付けを積極的に提案してください
- 期限切れや本日期限のタスクがあれば注意喚起してください
- 「今日も一緒に頑張りましょう！」のような前向きな締めくくりを`;
  }
  if (hour >= 12 && hour <= 16) {
    return `- 午後の進捗を気遣ってください
- 負荷が高そうなら休憩や優先順位の見直しを提案してください
- 残りの時間で取り組むべきタスクを整理してください`;
  }
  if (hour >= 17 && hour <= 23) {
    return `- 「お疲れ様です」とねぎらいの言葉から始めてください
- 日報作成を積極的にサポートしてください
- 今日の成果を振り返り、達成を認めてください
- 明日への引き継ぎ事項があれば整理してください`;
  }
  return `- 遅い時間の作業をねぎらってください
- 簡潔にサポートしてください
- 体調を気遣い、無理しないよう声をかけてください`;
}

function buildCompanionSystemPrompt(context: AIContext, enableTools?: boolean, projectId?: string | null): string {
  const currentHour = context.currentHour ?? new Date().getHours();
  const timePeriodLabel = getTimePeriodLabel(currentHour);
  const hasProject = !!projectId;

  let prompt = `あなたは「相棒」— ${context.user.displayName}さんのタスク管理パートナーです。

## あなたの性格
- 親しみやすく温かい口調（丁寧なカジュアル体）
- パートナーとして一緒に仕事を進める姿勢
- 努力を認め、適度に励ます
- 問題は一緒に考える

## 現在の時間帯: ${timePeriodLabel}
${getTimePeriodInstructions(currentHour)}

## 役割
1. **朝の計画**: タスク整理、優先順位付け、一日の目標設定
2. **日中のサポート**: 進捗確認、優先順位調整、困りごとの相談
3. **夕方の振り返り**: 日報生成、成果の振り返り、明日の準備
`;

  // Put tool instructions FIRST for Anthropic (better compliance)
  if (enableTools) {
    if (hasProject) {
      prompt += `
## 最重要ルール - ツールの使用

あなたには複数のツールが提供されています。**ユーザーに何かを聞き返す前に、必ずツールを使って情報を取得してください。**

### 絶対禁止事項
- 「リストIDを教えてください」と聞く → 代わりに get_lists を呼ぶ
- 「どのタスクですか？」と聞く → 代わりに get_tasks を呼ぶ
- 「メンバーIDが必要です」と言う → 代わりに get_members を呼ぶ

### 操作の手順
1. 「〜リストにタスク追加して」と言われたら:
   - まず get_lists を呼んでリストIDを取得
   - 取得したIDで create_task を呼ぶ

2. 「〜さんに担当を設定して」と言われたら:
   - まず get_members を呼んでメンバーIDを取得
   - 取得したIDで assign_task を呼ぶ

### プロジェクトツール
- get_lists, get_members, get_labels, get_tasks, get_project_summary
- create_task, update_task, delete_task, complete_task, move_task, assign_task

### クロスプロジェクトツール
- get_my_tasks_across_projects, get_workload_summary, suggest_work_priority, generate_daily_report

`;
    } else {
      prompt += `
## ツールの使用

あなたにはツールが提供されています。積極的にツールを使って情報を取得し、ユーザーに分かりやすく提示してください。

### ツール一覧
- get_my_tasks_across_projects: 全プロジェクトを横断して自分のタスクを取得
- get_workload_summary: ワークロードのサマリーを取得
- suggest_work_priority: 作業優先順位を提案
- generate_daily_report: 日報を生成
- update_task: タスクを更新（projectIdパラメータ必須）
- complete_task: タスクを完了/未完了にする（projectIdパラメータ必須）

### タスク修正の手順
1. まず get_my_tasks_across_projects でタスク一覧を取得（各タスクにprojectIdが含まれる）
2. 取得した projectId と taskId を使って update_task や complete_task を呼ぶ

`;

    }
  }

  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];

  prompt += `
## 現在のコンテキスト

### 日付情報
- 今日の日付: ${todayISO}
- 「今日から」「本日から」と言われた場合は ${todayISO} を開始日として使用してください

### ユーザー情報
- 名前: ${context.user.displayName}
`;

  if (hasProject && context.project) {
    prompt += `
### プロジェクト情報（現在のプロジェクト）
- プロジェクト名: ${context.project.name}
- 説明: ${context.project.description || 'なし'}
- リスト: ${context.project.lists.map((l) => `${l.name}(${l.taskCount}件)`).join(', ') || 'なし'}
- メンバー: ${context.project.members.map((m) => m.displayName).join(', ') || 'なし'}
`;

    if (context.task) {
      prompt += `
### 現在選択中のタスク
- タイトル: ${context.task.title}
- 説明: ${context.task.description || 'なし'}
- 優先度: ${context.task.priority || '未設定'}
- 期限: ${context.task.dueDate ? new Date(context.task.dueDate).toLocaleDateString('ja-JP') : '未設定'}
- ステータス: ${context.task.status}
- 担当者: ${context.task.assignees.join(', ') || '未割り当て'}
`;

      if (context.task.checklists.length > 0) {
        prompt += `- チェックリスト:\n`;
        for (const checklist of context.task.checklists) {
          prompt += `  - ${checklist.title}:\n`;
          for (const item of checklist.items) {
            prompt += `    - [${item.isChecked ? 'x' : ' '}] ${item.text}\n`;
          }
        }
      }

      if (context.task.comments.length > 0) {
        prompt += `- 最近のコメント:\n`;
        for (const comment of context.task.comments.slice(-3)) {
          prompt += `  - ${comment.authorName}: ${comment.content}\n`;
        }
      }
    }
  }

  if (!hasProject && context.projects && context.projects.length > 0) {
    prompt += `
### 参加プロジェクト（${context.projects.length}件）
`;
    for (const project of context.projects) {
      prompt += `- ${project.name}`;
      if (project.description) {
        prompt += `: ${project.description}`;
      }
      prompt += '\n';
    }
  }

  prompt += `
## 回答のガイドライン
- 日本語で回答してください
- 簡潔で分かりやすい回答を心がけてください
- タスク管理に関するアドバイスを提供してください
- 必要に応じてタスクの分解や優先順位付けの提案をしてください
${!hasProject ? '- プロジェクト横断で優先順位や作業負荷を分析してください\n- 日報やサマリーを出力する際は、マークダウン形式で見やすく整形してください' : ''}
`;

  return prompt + taskResolutionPrompt(context);
}
