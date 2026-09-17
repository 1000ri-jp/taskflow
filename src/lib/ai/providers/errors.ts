import type { AIProviderType } from '@/types/ai';

/** Safe to display: never retain the provider's raw error body or message. */
export class AIProviderError extends Error {
  constructor(readonly provider: AIProviderType, readonly status: number, code?: unknown) {
    const name = provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : 'Gemini';
    const message = status === 401
      ? `${name}のAPIキーが無効です。「設定 → AI設定」で有効なキーに更新してください。`
      : status === 429 && code === 'insufficient_quota'
        ? `${name}のAPI利用枠が不足しています。API側の残高・利用上限を確認してください。`
        : status === 429
          ? `${name}のリクエスト上限に達しました。少し待ってから再整理してください。`
          : status === 403 || status === 404
            ? `${name}のモデルを利用できません。AI設定のモデル名とAPI側の権限を確認してください。`
            : `${name}との接続でエラーが発生しました。時間をおいて再整理してください。`;
    super(message);
    this.name = 'AIProviderError';
  }
}
