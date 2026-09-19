import type { AIProviderType } from '@/types/ai';

export interface AIModelOption {
  id: string;
  label: string;
}

// Text/image input and tool-capable models, checked 2026-09-15:
// https://ai.google.dev/gemini-api/docs/models
// https://platform.claude.com/docs/en/models/overview
// https://developers.openai.com/api/docs/models/gpt-5.5
// Keep existing defaults selectable; do not migrate saved choices automatically.
// OpenAI presets must support tool calls through our Chat Completions transport.
export const AI_MODEL_OPTIONS: Record<AIProviderType, readonly AIModelOption[]> = {
  gemini: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro（プレビュー）' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash（プレビュー）' },
  ],
  openai: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-4o', label: 'GPT-4o' },
  ],
  anthropic: [
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  ],
};
