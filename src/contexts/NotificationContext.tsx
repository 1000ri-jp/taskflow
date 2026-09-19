'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  subscribeToUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  createNotification,
} from '@/lib/firebase/firestore';
import { useAuthStore } from '@/stores/authStore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Notification } from '@/types';
import { useOrganizationLabNotifications } from '@/hooks/useOrganizationLabNotifications';
import { isUnreadTaskComment } from '@/lib/comments/unread';

interface NotificationContextType {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: Error | null;
  markAsRead: (notificationId: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  remove: (notificationId: string) => Promise<void>;
  sendBellNotification: (
    projectId: string,
    projectName: string,
    taskId: string,
    taskName: string,
    message: string,
    assigneeIds: string[]
  ) => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | null>(null);

function initialNotificationState(userId: string | null) {
  return {
    userId,
    notifications: [] as Notification[],
    isLoading: userId !== null,
    error: null as Error | null,
  };
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuthStore();
  const mockMode = isE2EMockAuthEnabled();
  const lab = useOrganizationLabNotifications(mockMode, user?.id ?? null);
  const userId = mockMode ? null : user?.id || null;
  const [state, setState] = useState(() => initialNotificationState(userId));

  // Reset during render so even the first render for another user is scoped.
  // This also prevents an A -> B -> A switch from reviving A's old snapshot.
  if (state.userId !== userId) {
    setState(initialNotificationState(userId));
  }
  const { notifications, isLoading, error } = mockMode ? lab : state.userId === userId
    ? state
    : initialNotificationState(userId);

  // Subscribe to notifications (only once per user)
  useEffect(() => {
    if (!userId) return;

    let active = true;
    let unsubscribe: (() => void) | undefined;
    const fail = (error: Error) => {
      if (!active) return;
      setState({ userId, notifications: [], isLoading: false, error });
    };

    try {
      unsubscribe = subscribeToUserNotifications(userId, (notifications) => {
        if (!active) return;
        setState({ userId, notifications, isLoading: false, error: null });
      }, fail);
    } catch (error) {
      // Initialization can fail before Firestore installs an error listener.
      queueMicrotask(() => {
        fail(error instanceof Error ? error : new Error('通知を取得できませんでした'));
      });
    }

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const markAsRead = useCallback(async (notificationId: string) => {
    if (isE2EMockAuthEnabled()) {const {mutateOrganizationMock,ORGANIZATION_MOCK_PROJECT}=await import('@/lib/task/organizationMock');await mutateOrganizationMock(ORGANIZATION_MOCK_PROJECT,w=>{w.notificationReads=[...new Set([...(w.notificationReads??[]),notificationId])];});return;}
    await markNotificationAsRead(notificationId);
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (isE2EMockAuthEnabled()) {const {mutateOrganizationMock,ORGANIZATION_MOCK_PROJECT}=await import('@/lib/task/organizationMock');await mutateOrganizationMock(ORGANIZATION_MOCK_PROJECT,w=>{w.notificationReads=[...new Set([...(w.notificationReads??[]),...notifications.map(n=>n.id)])];});return;}
    if (user?.id) {
      await markAllNotificationsAsRead(user.id);
    }
  }, [user,notifications]);

  const remove = useCallback(async (notificationId: string) => {
    if (isE2EMockAuthEnabled()) return;
    await deleteNotification(notificationId);
  }, []);

  const sendBellNotification = useCallback(
    async (
      projectId: string,
      projectName: string,
      taskId: string,
      taskName: string,
      message: string,
      assigneeIds: string[]
    ) => {
      if (isE2EMockAuthEnabled() || !user) return;

      // Include sender in notification recipients for confirmation
      const recipientIds = [...new Set([...assigneeIds, user.id])];

      const promises = recipientIds.map((userId) =>
        createNotification({
          userId,
          type: 'task_bell',
          title: `${user.displayName || 'ユーザー'}からのメッセージ`,
          message: message || `${taskName}へのアサイン`,
          projectId,
          projectName,
          taskId,
          taskName,
          senderId: user.id,
          senderName: user.displayName || 'ユーザー',
          isRead: false,
          data: {},
        })
      );

      await Promise.all(promises);
    },
    [user]
  );

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        isLoading,
        error,
        markAsRead,
        markAllAsRead,
        remove,
        sendBellNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
}

/** Reuses the shared notification stream; standalone cards can render without a provider. */
export function useTaskCommentUnread(projectId: string, taskId: string) {
  const context = useContext(NotificationContext);
  const { user } = useAuthStore();
  return {
    hasUnread: Boolean(user && context?.notifications.some(notification => notification.userId === user.id && isUnreadTaskComment(notification, projectId, taskId))),
    isLoading: context?.isLoading ?? false,
    error: context?.error ?? null,
  };
}
