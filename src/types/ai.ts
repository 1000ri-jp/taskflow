// AI Provider types
export type AIProviderType = 'openai' | 'anthropic' | 'gemini';

export interface AIProviderConfig {
  type: AIProviderType;
  apiKey: string;
  model?: string;
}

// Message types
export interface AIMessage {
  images?: { mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string }[];
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  createdAt: Date;
  // For assistant messages with tool calls
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    // Gemini 3: thought signature for function calls (required for tool responses)
    thoughtSignature?: string;
  }>;
  // For tool result messages
  toolCallId?: string;
  toolName?: string; // Function name for the tool result (needed by Gemini)
  // Gemini 3: thought signature must be returned with function response
  thoughtSignature?: string;
}

// Conversation types
export interface AIConversation {
  mode?: 'description' | 'draft';
  id: string;
  projectId: string | null;  // For project scope, null for personal/companion
  scope: AIScope;             // 'project' | 'personal' | 'companion'
  title: string;
  contextType: 'task' | 'project' | 'personal' | null;
  contextId: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// Context types for AI
export interface AITaskContext {
  id: string;
  title: string;
  description: string;
  priority: string | null;
  dueDate: Date | null;
  status: string; // List name
  assignees: string[];
  comments: Array<{
    content: string;
    authorName: string;
    createdAt: Date;
  }>;
  checklists: Array<{
    title: string;
    items: Array<{
      text: string;
      isChecked: boolean;
    }>;
  }>;
}

export interface AIProjectContext {
  id: string;
  name: string;
  description: string;
  lists: Array<{
    id: string;
    name: string;
    taskCount: number;
  }>;
  members: Array<{
    id: string;
    displayName: string;
  }>;
}

// AI Scope type
export type AIScope = 'project' | 'personal' | 'companion';

export interface AIContext {
  scope: AIScope;
  task?: AITaskContext;
  project?: AIProjectContext;      // For project scope
  projects?: AIProjectContext[];   // For personal scope (all user's projects)
  user: {
    id: string;
    displayName: string;
  };
  currentHour?: number; // クライアント側の現在時刻（時間帯対応プロンプト用）
}

// Chat request/response types
export interface AIChatRequest {
  projectId: string;
  conversationId?: string;
  message: string;
  context: AIContext;
  provider: AIProviderType;
}

export interface AIChatResponse {
  conversationId: string;
  messageId: string;
  content: string;
}

// Settings types
export interface AISettings {
  provider: AIProviderType;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  openaiModel?: string;
  anthropicModel?: string;
  geminiModel?: string;
}

// Default models
export const DEFAULT_MODELS: Record<AIProviderType, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  gemini: 'gemini-3-flash-preview',
};

// Provider display names
export const PROVIDER_DISPLAY_NAMES: Record<AIProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google (Gemini)',
};
