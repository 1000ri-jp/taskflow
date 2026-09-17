'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { AIContext, AIMessage } from '@/types/ai';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import { ToolCall } from '@/lib/ai/tools/types';
import { executeUnifiedTools, requiresConfirmation } from '@/lib/ai/toolExecutor';
import {
  createUnifiedConversation,
  addUnifiedMessage as saveMessage,
  getUnifiedMessages,
  generateTitleFromMessage,
  updateUnifiedConversationTitle,
} from '@/lib/ai/conversationStorage';
import { getAuthHeaders } from '@/lib/firebase/authToken';

interface UseUnifiedConversationOptions {
  userId: string;
  projectId: string | null;
  projectIds?: string[];
  context: AIContext;
  conversationId: string | null;
  onConversationCreated?: (id: string) => void;
  onToolConfirmRequired?: (toolCalls: ToolCall[]) => void;
}

interface UseUnifiedConversationReturn {
  messages: AIMessage[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (content: string, supportOverride?: string) => Promise<void>;
  confirmToolExecution: (toolCalls: ToolCall[]) => Promise<void>;
  cancelToolExecution: () => void;
  loadConversation: (conversationId: string) => Promise<void>;
  clearMessages: () => void;
}

const MAX_TOOL_CHAIN_DEPTH = 5;

export function useUnifiedConversation({
  userId,
  projectId,
  projectIds,
  context,
  conversationId,
  onConversationCreated,
  onToolConfirmRequired,
}: UseUnifiedConversationOptions): UseUnifiedConversationReturn {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(conversationId);

  const toolChainDepthRef = useRef(0);
  const supportOverrideRef = useRef<string | undefined>(undefined);
  const pendingToolCallsRef = useRef<ToolCall[] | null>(null);

  const { provider, getActiveModel } = useAISettingsStore();

  // Sync conversationId from props
  useEffect(() => {
    setCurrentConversationId(conversationId);
    if (!conversationId) {
      setMessages([]);
    }
  }, [conversationId]);

  const loadConversation = useCallback(async (convId: string) => {
    if (!userId) return;

    try {
      const loadedMessages = await getUnifiedMessages(userId, convId);
      setMessages(loadedMessages);
    } catch {
      // Failed to load - will start fresh
    }
  }, [userId]);

  // Load conversation when ID changes
  useEffect(() => {
    if (conversationId && userId) {
      loadConversation(conversationId);
    }
  }, [conversationId, userId, loadConversation]);

  const persistMessage = useCallback(async (
    convId: string,
    message: Omit<AIMessage, 'id' | 'createdAt'>
  ): Promise<string | null> => {
    if (!userId) return null;

    try {
      return await saveMessage(userId, convId, message);
    } catch {
      return null;
    }
  }, [userId]);

  /**
   * Call the AI API with auth token (API key is retrieved server-side)
   */
  const callAI = useCallback(async (
    messagesToSend: AIMessage[],
    onText: (content: string) => void,
    onToolCalls: (toolCalls: ToolCall[]) => void,
  ): Promise<{ content: string; toolCalls: ToolCall[] | null }> => {
    const model = getActiveModel();
    const headers = await getAuthHeaders();

    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: messagesToSend,
        context,
        provider,
        model,
        enableTools: true,
        projectId: projectId || undefined,
        supportOverride: supportOverrideRef.current,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'API request failed');
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let fullContent = '';
    let toolCalls: ToolCall[] | null = null;
    let buffer = ''; // Buffer for incomplete lines across chunks

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      // Split by newlines but keep the last incomplete line in buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep the last (potentially incomplete) line

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith('data: ')) {
          const data = trimmedLine.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) throw new Error(parsed.error);

            if (parsed.type === 'text' && parsed.content) {
              fullContent += parsed.content;
              // Use flushSync to force immediate render during streaming
              flushSync(() => {
                onText(fullContent);
              });
            } else if (parsed.type === 'tool_calls' && parsed.toolCalls) {
              toolCalls = parsed.toolCalls;
              onToolCalls(parsed.toolCalls as ToolCall[]);
            }
          } catch (e) {
            // Ignore JSON parse errors for incomplete data (can happen at chunk boundaries)
            const errorMsg = e instanceof Error ? e.message : '';
            const isIncompleteJson = errorMsg.includes('Unexpected end') ||
                                      errorMsg.includes('Unterminated string') ||
                                      errorMsg.includes('Unexpected token');
            if (!isIncompleteJson) {
              throw e;
            }
          }
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      const trimmedLine = buffer.trim();
      if (trimmedLine.startsWith('data: ')) {
        const data = trimmedLine.slice(6);
        if (data !== '[DONE]') {
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'text' && parsed.content) {
              fullContent += parsed.content;
              onText(fullContent);
            } else if (parsed.type === 'tool_calls' && parsed.toolCalls) {
              toolCalls = parsed.toolCalls;
              onToolCalls(parsed.toolCalls as ToolCall[]);
            }
          } catch {
            // Ignore final incomplete JSON
          }
        }
      }
    }

    return { content: fullContent, toolCalls };
  }, [context, provider, getActiveModel, projectId]);

  const processToolCalls = useCallback(async (
    toolCalls: ToolCall[],
    currentMessages: AIMessage[],
    convId: string,
  ): Promise<void> => {
    toolChainDepthRef.current++;
    if (toolChainDepthRef.current > MAX_TOOL_CHAIN_DEPTH) {
      return;
    }

    const defaultListId = context.project?.lists[0]?.id;
    const sourceUserMessage=[...currentMessages].reverse().find(message=>message.role==='user');
    const results = await executeUnifiedTools(toolCalls, {
      sourceUserMessage:sourceUserMessage?{id:sourceUserMessage.id,content:sourceUserMessage.content}:undefined,
      scope: projectId ? 'project' : 'personal',
      projectId: projectId || '',
      projectIds: projectIds,
      userId,
      listId: defaultListId,
    });

    const updatedMessages = [...currentMessages];
    const lastIndex = updatedMessages.length - 1;
    if (updatedMessages[lastIndex]?.role === 'assistant') {
      updatedMessages[lastIndex] = {
        ...updatedMessages[lastIndex],
        toolCalls: toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
          thoughtSignature: tc.thoughtSignature,
        })),
      };
    }

    await persistMessage(convId, {
      role: 'assistant',
      content: updatedMessages[lastIndex]?.content || '',
      toolCalls: updatedMessages[lastIndex]?.toolCalls,
    });

    const toolResultMessages: AIMessage[] = results.map((result, index) => ({
      id: crypto.randomUUID(),
      role: 'tool' as const,
      content: JSON.stringify(result.success ? result.result : { error: result.error }),
      createdAt: new Date(),
      toolCallId: toolCalls[index].id,
      toolName: toolCalls[index].name,
      thoughtSignature: toolCalls[index].thoughtSignature,
    }));

    for (const msg of toolResultMessages) {
      await persistMessage(convId, {
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolName: msg.toolName,
        thoughtSignature: msg.thoughtSignature,
      });
    }

    const messagesWithToolResults = [...updatedMessages, ...toolResultMessages];

    const assistantPlaceholder: AIMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date(),
    };

    setMessages([...messagesWithToolResults, assistantPlaceholder]);

    const { content, toolCalls: newToolCalls } = await callAI(
      messagesWithToolResults,
      (text) => {
        setMessages(prev => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant') {
            updated[lastIdx] = { ...updated[lastIdx], content: text };
          }
          return updated;
        });
      },
      () => {}
    );

    const finalMessages = [...messagesWithToolResults];
    finalMessages.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      createdAt: new Date(),
    });
    setMessages(finalMessages);

    if (newToolCalls && newToolCalls.length > 0) {
      if (requiresConfirmation(newToolCalls)) {
        pendingToolCallsRef.current = newToolCalls;
        onToolConfirmRequired?.(newToolCalls);
      } else {
        await processToolCalls(newToolCalls, finalMessages, convId);
      }
    } else {
      if (content) {
        await persistMessage(convId, { role: 'assistant', content });
      }
    }
  }, [projectId, projectIds, userId, context, callAI, persistMessage, onToolConfirmRequired]);

  const sendMessage = useCallback(async (content: string, supportOverride?: string) => {
    if (!userId) return;
    supportOverrideRef.current = supportOverride;

    setIsLoading(true);
    setError(null);
    toolChainDepthRef.current = 0;

    try {
      let convId = currentConversationId;
      if (!convId) {
        convId = await createUnifiedConversation(userId, {
          projectId: projectId || null,
          contextType: projectId
            ? (context.task ? 'task' : 'project')
            : 'personal',
          contextId: context.task?.id || (projectId ? context.project?.id : null) || null,
        });
        setCurrentConversationId(convId);
        onConversationCreated?.(convId);

        const title = generateTitleFromMessage(content);
        await updateUnifiedConversationTitle(userId, convId, title);
      }

      const userMessage: AIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        createdAt: new Date(),
      };

      await persistMessage(convId, { role: 'user', content });

      const assistantPlaceholder: AIMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      };

      const newMessages = [...messages, userMessage, assistantPlaceholder];
      setMessages(newMessages);

      const messagesToSend = [...messages, userMessage];
      const { content: responseContent, toolCalls } = await callAI(
        messagesToSend,
        (text) => {
          setMessages(prev => {
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            if (updated[lastIdx]?.role === 'assistant') {
              updated[lastIdx] = { ...updated[lastIdx], content: text };
            }
            return updated;
          });
        },
        () => {}
      );

      const updatedMessages = [...messages, userMessage];
      updatedMessages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: responseContent,
        createdAt: new Date(),
      });
      setMessages(updatedMessages);

      if (toolCalls && toolCalls.length > 0) {
        if (requiresConfirmation(toolCalls)) {
          pendingToolCallsRef.current = toolCalls;
          onToolConfirmRequired?.(toolCalls);
        } else {
          await processToolCalls(toolCalls, updatedMessages, convId);
        }
      } else {
        if (responseContent) {
          await persistMessage(convId, { role: 'assistant', content: responseContent });
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [
    userId,
    projectId,
    context,
    currentConversationId,
    messages,
    callAI,
    processToolCalls,
    persistMessage,
    onConversationCreated,
    onToolConfirmRequired,
  ]);

  const confirmToolExecution = useCallback(async (toolCalls: ToolCall[]) => {
    if (!currentConversationId) return;

    setIsLoading(true);
    // finally でクリアすると、processToolCalls の連鎖中に発生した次の確認要求
    // （pendingToolCallsRef への再セット）を上書きしてしまうため、実行開始時にクリアする
    pendingToolCallsRef.current = null;
    try {
      await processToolCalls(toolCalls, messages, currentConversationId);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [currentConversationId, messages, processToolCalls]);

  const cancelToolExecution = useCallback(() => {
    pendingToolCallsRef.current = null;
    setMessages(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      if (updated[lastIdx]?.role === 'assistant') {
        updated[lastIdx] = {
          ...updated[lastIdx],
          content: updated[lastIdx].content + '\n\n（操作がキャンセルされました）',
        };
      }
      return updated;
    });
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setCurrentConversationId(null);
    toolChainDepthRef.current = 0;
    pendingToolCallsRef.current = null;
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    confirmToolExecution,
    cancelToolExecution,
    loadConversation,
    clearMessages,
  };
}
