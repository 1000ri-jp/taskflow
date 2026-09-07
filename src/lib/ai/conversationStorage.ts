import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { getFirebaseDb } from '@/lib/firebase/config';
import { AIConversation, AIMessage, AIScope } from '@/types/ai';

// Resolve Firebase lazily. This module is imported by the dashboard's always
// mounted AI panel, including local mock-auth runs where Firebase credentials
// are intentionally absent.
const getDb = () => getFirebaseDb();

// Collection paths
const getConversationsCollection = (userId: string) =>
  collection(getDb(), 'users', userId, 'conversations');

const getMessagesCollection = (userId: string, conversationId: string) =>
  collection(getDb(), 'users', userId, 'conversations', conversationId, 'messages');

// Convert Firestore timestamp to Date
const toDate = (timestamp: Timestamp | null | undefined): Date =>
  timestamp?.toDate() || new Date();

/**
 * Generate a title from the first message
 */
export function generateTitleFromMessage(content: string): string {
  // Take first 30 characters and add ellipsis if truncated
  const maxLength = 30;
  if (content.length <= maxLength) {
    return content;
  }
  return content.substring(0, maxLength) + '...';
}

/**
 * Create a new conversation
 */
export async function createUnifiedConversation(
  userId: string,
  options?: {
    projectId?: string | null;
    title?: string;
    contextType?: 'task' | 'project' | 'personal' | null;
    contextId?: string | null;
  }
): Promise<string> {
  const conversationsRef = getConversationsCollection(userId);

  const docRef = await addDoc(conversationsRef, {
    title: options?.title || '新しい会話',
    scope: 'companion' as AIScope,
    projectId: options?.projectId || null,
    contextType: options?.contextType || null,
    contextId: options?.contextId || null,
    createdBy: userId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Subscribe to unified conversations for a user.
 * Optionally filter by projectId.
 */
export function subscribeToUnifiedConversations(
  userId: string,
  callback: (conversations: AIConversation[]) => void,
  options?: { projectId?: string | null }
): () => void {
  const conversationsRef = getConversationsCollection(userId);
  let q;

  if (options?.projectId) {
    q = query(
      conversationsRef,
      where('projectId', '==', options.projectId),
      orderBy('updatedAt', 'desc')
    );
  } else if (options?.projectId === null) {
    // Explicitly null = dashboard (no project)
    q = query(
      conversationsRef,
      where('projectId', '==', null),
      orderBy('updatedAt', 'desc')
    );
  } else {
    // No filter = all conversations
    q = query(conversationsRef, orderBy('updatedAt', 'desc'));
  }

  return onSnapshot(q, (snapshot) => {
    const conversations = snapshot.docs.map((doc) => ({
      id: doc.id,
      projectId: doc.data().projectId || null,
      scope: (doc.data().scope || 'companion') as AIScope,
      title: doc.data().title,
      contextType: doc.data().contextType,
      contextId: doc.data().contextId,
      createdBy: doc.data().createdBy,
      createdAt: toDate(doc.data().createdAt),
      updatedAt: toDate(doc.data().updatedAt),
    }));
    callback(conversations);
  });
}

/**
 * Add a message to a unified conversation
 */
export async function addUnifiedMessage(
  userId: string,
  conversationId: string,
  message: Omit<AIMessage, 'id' | 'createdAt'>
): Promise<string> {
  const messagesRef = getMessagesCollection(userId, conversationId);

  const messageData: Record<string, unknown> = {
    role: message.role,
    content: message.content,
    createdAt: serverTimestamp(),
  };

  if (message.toolCalls && message.toolCalls.length > 0) {
    messageData.toolCalls = message.toolCalls.map((tc) => {
      const clean: Record<string, unknown> = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      };
      if (tc.thoughtSignature) clean.thoughtSignature = tc.thoughtSignature;
      return clean;
    });
  }

  if (message.toolCallId) {
    messageData.toolCallId = message.toolCallId;
  }
  if (message.toolName) {
    messageData.toolName = message.toolName;
  }
  if (message.thoughtSignature) {
    messageData.thoughtSignature = message.thoughtSignature;
  }

  const docRef = await addDoc(messagesRef, messageData);

  // Update conversation's updatedAt
  const conversationRef = doc(getDb(), 'users', userId, 'conversations', conversationId);
  await updateDoc(conversationRef, {
    updatedAt: serverTimestamp(),
  });

  return docRef.id;
}

/**
 * Get all messages for a unified conversation
 */
export async function getUnifiedMessages(
  userId: string,
  conversationId: string
): Promise<AIMessage[]> {
  const messagesRef = getMessagesCollection(userId, conversationId);
  const q = query(messagesRef, orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    const message: AIMessage = {
      id: doc.id,
      role: data.role,
      content: data.content,
      createdAt: toDate(data.createdAt),
    };

    if (data.toolCalls) {
      message.toolCalls = data.toolCalls;
    }
    if (data.toolCallId) {
      message.toolCallId = data.toolCallId;
    }
    if (data.toolName) {
      message.toolName = data.toolName;
    }
    if (data.thoughtSignature) {
      message.thoughtSignature = data.thoughtSignature;
    }

    return message;
  });
}

/**
 * Update unified conversation title
 */
export async function updateUnifiedConversationTitle(
  userId: string,
  conversationId: string,
  title: string
): Promise<void> {
  const docRef = doc(getDb(), 'users', userId, 'conversations', conversationId);
  await updateDoc(docRef, {
    title,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a unified conversation and all its messages
 */
export async function deleteUnifiedConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  const messagesRef = getMessagesCollection(userId, conversationId);
  const messagesSnapshot = await getDocs(messagesRef);

  const deletePromises = messagesSnapshot.docs.map((doc) => deleteDoc(doc.ref));
  await Promise.all(deletePromises);

  const conversationRef = doc(getDb(), 'users', userId, 'conversations', conversationId);
  await deleteDoc(conversationRef);
}
