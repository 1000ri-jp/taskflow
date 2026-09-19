export interface DescriptionOperation {
  id: string; conversationId: string; sourceMessageId: string; projectId: string; taskId: string; taskTitle: string;
  source: string; before: string; beforeVersion: string; after: string;
  approval: 'explicit' | 'required'; state: 'preparing' | 'prepared' | 'applied' | 'undone' | 'failed';
  afterVersion: string | null; attempt: string; leaseUntil: number; createdAt: string;
}
export interface ScopedConversationView {
  conversationId: string; mode: 'description' | 'draft'; title: string;
  messages: { id: string; role: 'user' | 'assistant'; content: string; createdAt: string; operation?: DescriptionOperation; retry?: boolean; sourceWarning?: string }[];
  sourceUrl?: string; sourceNotice?: string; sourceWarning?: string;
}
export function explicitDescription(input: string): string | null {
  const match = /^(?:このタスクの)?説明(?:文)?を「([^「」]*)」に(?:変更|更新)(?:して(?:ください)?|してください|する)?[。！!]?$/u.exec(input.trim());
  return match && match[1].length <= 8000 ? match[1] : null;
}

export interface UnsavedDraft { conversationId: string; requestId: string; content: string; body: string }
