'use client';

import { useState, useEffect, useCallback } from 'react';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { listMockScoped, deleteMockScoped } from '@/lib/ai/scopedConversationMock';
import { AIConversation } from '@/types/ai';
import {
  createUnifiedConversation,
  updateUnifiedConversationTitle,
  deleteUnifiedConversation,
  subscribeToUnifiedConversations,
} from '@/lib/ai/conversationStorage';

interface UseUnifiedConversationsOptions {
  userId: string | null;
  projectId?: string | null;
}

interface UseUnifiedConversationsReturn {
  conversations: AIConversation[];
  isLoading: boolean;
  error: string | null;
  createNewConversation: (options?: {
    projectId?: string | null;
    title?: string;
  }) => Promise<string | null>;
  updateTitle: (conversationId: string, title: string) => Promise<void>;
  deleteConversationById: (conversationId: string) => Promise<void>;
}

export function useUnifiedConversations({
  userId,
  projectId,
}: UseUnifiedConversationsOptions): UseUnifiedConversationsReturn {
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to conversations (filtered by projectId if provided)
  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => {
        setConversations([]);
        setIsLoading(false);
      });
      return;
    }

    queueMicrotask(() => {
      setIsLoading(true);
      setError(null);
    });

    if (isE2EMockAuthEnabled()) {
      const refresh = () => { setConversations(projectId ? [] : listMockScoped(userId)); setIsLoading(false); };
      queueMicrotask(refresh); window.addEventListener('taskflow-scoped-history', refresh);
      return () => window.removeEventListener('taskflow-scoped-history', refresh);
    }
    const unsubscribe = subscribeToUnifiedConversations(
      userId,
      (convs) => {
        setConversations(convs);
        setIsLoading(false);
      },
      // Pass projectId for filtering
      // undefined = no filter (all conversations)
      // null = dashboard conversations only
      // string = specific project conversations
      projectId !== undefined ? { projectId } : undefined
    );

    return () => unsubscribe();
  }, [userId, projectId]);

  const createNewConversation = useCallback(
    async (options?: {
      projectId?: string | null;
      title?: string;
    }): Promise<string | null> => {
      if (!userId) return null;

      try {
        const conversationId = await createUnifiedConversation(userId, {
          projectId: options?.projectId ?? projectId ?? null,
          title: options?.title,
        });
        return conversationId;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to create conversation';
        setError(errorMessage);
        return null;
      }
    },
    [userId, projectId]
  );

  const updateTitle = useCallback(
    async (conversationId: string, title: string): Promise<void> => {
      if (!userId) return;

      try {
        await updateUnifiedConversationTitle(userId, conversationId, title);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to update title';
        setError(errorMessage);
      }
    },
    [userId]
  );

  const deleteConversationById = useCallback(
    async (conversationId: string): Promise<void> => {
      if (!userId) return;

      try {
        if (isE2EMockAuthEnabled()) { deleteMockScoped(userId, conversationId); return; }
        await deleteUnifiedConversation(userId, conversationId);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete conversation';
        setError(errorMessage);
      }
    },
    [userId]
  );

  return {
    conversations,
    isLoading,
    error,
    createNewConversation,
    updateTitle,
    deleteConversationById,
  };
}
