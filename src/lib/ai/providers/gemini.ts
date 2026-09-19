import { taskResolutionPrompt } from '../taskResolutionPrompt';
import { AIContext, AIMessage, DEFAULT_MODELS } from '@/types/ai';
import { AIProvider, StreamChunk, SendMessageOptions } from './types';
import { getGeminiTools } from '../tools';
import { ToolCall } from '../tools/types';
import { AIProviderError } from './errors';

/**
 * Convert AIMessage array to Gemini content format
 * Handles function calls (model) and function responses (user)
 */
function convertMessagesToGemini(messages: AIMessage[]): Array<{
  role: 'user' | 'model';
  parts: Array<Record<string, unknown>>;
}> {
  const result: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }> = [];

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // Check if this is an assistant message with tool calls
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const parts: Array<Record<string, unknown>> = [];

        // Add text content if present
        if (msg.content) {
          parts.push({ text: msg.content });
        }

        // Add function call parts with thoughtSignature (required for Gemini 3)
        for (const toolCall of msg.toolCalls) {
          const functionCallPart: Record<string, unknown> = {
            functionCall: {
              name: toolCall.name,
              args: toolCall.arguments,
            },
          };
          // Gemini 3: thoughtSignature must be a SIBLING of functionCall, not inside it
          if (toolCall.thoughtSignature) {
            functionCallPart.thoughtSignature = toolCall.thoughtSignature;
          }
          parts.push(functionCallPart);
        }

        result.push({
          role: 'model',
          parts,
        });
      } else {
        // Regular text-only assistant message
        result.push({
          role: 'model',
          parts: [{ text: msg.content }],
        });
      }
    } else if (msg.role === 'tool') {
      // Tool result message - becomes a user message with functionResponse
      // Parse the content as it's stored as JSON string
      let responseData: unknown;
      try {
        responseData = JSON.parse(msg.content);
      } catch {
        responseData = { result: msg.content };
      }

      // Note: thoughtSignature stays with the model's functionCall, not in functionResponse
      const functionResponsePart: Record<string, unknown> = {
        functionResponse: {
          name: msg.toolName || msg.toolCallId || 'unknown', // Gemini needs the function name
          response: responseData,
        },
      };
      result.push({
        role: 'user',
        parts: [functionResponsePart],
      });
    } else {
      // User message
      result.push({
        role: 'user',
        parts: [{ text: msg.content }, ...(msg.images ?? []).map(image=>({inlineData:{mimeType:image.mimeType,data:image.data}}))],
      });
    }
  }

  return result;
}

export class GeminiProvider implements AIProvider {
  name = 'gemini' as const;

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
    const modelToUse = model || DEFAULT_MODELS.gemini;

    // Convert messages to Gemini format (handles function calls and responses)
    const geminiMessages = convertMessagesToGemini(messages);

    // Build contents array with system instruction as first user message
    const contents = [
      {
        role: 'user',
        parts: [{ text: systemPrompt }],
      },
      {
        role: 'model',
        parts: [{ text: 'わかりました。タスク管理のサポートをさせていただきます。' }],
      },
      ...geminiMessages,
    ];

    const requestBody: Record<string, unknown> = {
      contents: options?.systemPrompt ? geminiMessages : contents,
      ...(options?.systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
      generationConfig: {
        maxOutputTokens: options?.maxOutputTokens ?? 16384,
        ...(options?.geminiThinkingLevel && /^gemini-3[.-]/.test(modelToUse) ? { thinkingConfig: { thinkingLevel: options.geminiThinkingLevel } } : {}),
      },
    };

    // Add tools if enabled - allow chained tool calls for multi-step operations
    if (options?.enableTools) {
      requestBody.tools = getGeminiTools({ projectId: resolvedProjectId });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelToUse}:streamGenerateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // Provider errors may contain private input. Never log or return the raw body.
      throw new AIProviderError('gemini', response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls: ToolCall[] = [];

    try {
      // Collect all data from stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
      }

      // Gemini returns a JSON array like: [{...}, {...}]
      // Parse the entire response
      let responseArray;
      try {
        responseArray = JSON.parse(buffer);
      } catch {
        throw new Error('Failed to parse Gemini response');
      }

      if (!Array.isArray(responseArray)) {
        responseArray = [responseArray];
      }

      // Process each response object
      for (const response of responseArray) {
        // Check for errors
        if (response.error) {
          throw new AIProviderError('gemini', Number(response.error.code) || 503);
        }

        const candidate = response.candidates?.[0];
        if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('Incomplete Gemini response');
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            // Handle text content
            if (part.text && !part.thought) {
              yield { type: 'text', content: part.text };
            }

            // Handle function calls
            if (part.functionCall) {
              // thoughtSignature is a SIBLING of functionCall, not inside it
              const thoughtSig = part.thoughtSignature || part.thought_signature;
              toolCalls.push({
                id: `gemini-${Date.now()}-${toolCalls.length}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args || {},
                // Gemini 3: Capture thoughtSignature for function response
                thoughtSignature: thoughtSig,
              });
            }
          }
        }
      }

      // Emit tool calls if any
      if (toolCalls.length > 0) {
        yield { type: 'tool_calls', toolCalls };
      }
      yield { type: 'done' };
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * Unified companion system prompt builder.
 * Always uses "相棒" personality. Adds project context when projectId is present.
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
  const today = new Date();
  const todayISO = today.toISOString().split('T')[0];
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

## 現在のコンテキスト

### 日付情報
- 今日の日付: ${todayISO}
- 「今日から」「本日から」と言われた場合は ${todayISO} を開始日として使用してください

### ユーザー情報
- 名前: ${context.user.displayName}
`;

  // Project context (when on a project page)
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

  // Cross-project overview (dashboard)
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

  // Tool instructions
  if (enableTools) {
    if (hasProject) {
      prompt += `
## ツールの使用（非常に重要）

### 最重要ルール
**質問には情報取得ツール（get_*）を使い、依頼にはタスク操作ツールを使ってください。**

⚠️ **絶対にやってはいけないこと**：
- 「タスクはいくつある？」という質問に対して「タスク数を調べる」というタスクを作成する
- 「完了したタスクは？」という質問に対して「完了タスクを確認する」というタスクを作成する
- 質問への回答としてcreate_taskを使う

### 質問への対応（情報取得ツールを使う）
以下のような**質問**には、必ず**get_*ツール**で情報を取得してください：

| ユーザーの発言パターン | 使うべきツール |
|----------------------|--------------|
| 「〜はいくつ？」「〜の数は？」「何件ある？」 | get_project_summary または get_tasks |
| 「完了したタスクは？」「タスクの状況は？」 | get_project_summary |
| 「期限切れのタスクはある？」「遅れているタスクは？」 | get_overdue_tasks |
| 「私のタスクは？」「自分の担当は？」 | get_my_tasks |
| 「〜の詳細を教えて」「〜について教えて」 | get_task_details |
| 「タスク一覧を見せて」「何がある？」 | get_tasks |
| 「リスト一覧」「一番左のリスト」「どんなリストがある？」 | get_lists |
| 「メンバー一覧」「誰がいる？」「担当者は誰？」 | get_members |
| 「ラベル一覧」「どんなラベルがある？」 | get_labels |

### 依頼への対応（タスク操作ツールを使う）
以下のような**依頼・命令**には、タスク操作ツールを使ってください：

| ユーザーの発言パターン | 使うべきツール |
|----------------------|--------------|
| 「〜を作成して」「〜を追加して」「〜というタスクを作って」 | create_task / create_tasks |
| 「〜を変更して」「期限を〜に」「優先度を〜に」 | update_task |
| 「〜を完了にして」「〜を終わらせて」 | complete_task |
| 「〜を削除して」 | delete_task |
| 「〜を別のリストに移動して」 | move_task |
| 「〜を担当に設定して」 | assign_task |

### クロスプロジェクトツール
- get_my_tasks_across_projects: 全プロジェクトの自分のタスクを取得
- get_workload_summary: ワークロードサマリーを取得
- suggest_work_priority: 作業優先順位を提案
- generate_daily_report: 日報を生成

### 具体例
✅ 正しい：「完了したタスクは何件？」→ get_project_summary を呼び出し → 結果を回答
❌ 間違い：「完了したタスクは何件？」→ create_task({title: "完了タスクを数える"})

✅ 正しい：「買い物リストを作成して」→ create_task({title: "買い物リスト"})
❌ 間違い：「タスクの状況は？」→ create_task({title: "タスク状況を確認"})
`;
    } else {
      prompt += `
## ツールの使用

積極的にツールを使って情報を取得し、ユーザーに分かりやすく提示してください。

### ツール一覧
- get_my_tasks_across_projects: 全プロジェクトの自分のタスクを取得
- get_workload_summary: ワークロードサマリーを取得
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
