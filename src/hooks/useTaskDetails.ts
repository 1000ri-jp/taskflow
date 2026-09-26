'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { publishTaskCommentPresence, publishTaskCommentSnapshot, failTaskCommentPresence } from '@/lib/comments/taskPresence';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { DetailMockAction } from '@/lib/task/detailMock';
import { reorderChecklistItem } from '@/lib/firebase/checklist-order';
import { mutateChecklistItem } from '@/lib/firebase/checklist-item';
import type { ChecklistItemMutation, ChecklistDeadline } from '@/lib/utils/checklist-item';
import {
  getTask,
  getTaskChecklists,
  subscribeToTaskChecklists,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  createComment,
  deleteComment,
  updateComment,
  subscribeToTaskComments,
  getTaskAttachments,
  createAttachment,
  deleteAttachment,
  subscribeToTaskAttachments,
} from '@/lib/firebase/firestore';
import { uploadFile, deleteFile, uploadCommentAttachment } from '@/lib/firebase/storage';
import type { Task, Checklist, Comment, Attachment, CommentAttachment } from '@/types';

export function useTaskDetails(projectId: string | null, taskId: string | null) {
  const userId = useAuthStore(state => state.user?.id ?? null);
  const [task, setTask] = useState<Task | null>(null);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentStatus, setCommentStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scopeVersion = useRef(0);

  // Fetch task details
  useEffect(() => {
    const version = ++scopeVersion.current;
    if (!projectId || !taskId) {
      setTask(null);
      setChecklists([]);
      setComments([]);
      setCommentStatus('ready');
      setDetailsError(null);
      setAttachments([]);
      setIsLoading(false);
      return;
    }

    setComments([]);
    setChecklists([]);
    setAttachments([]);
    setCommentStatus('loading');
    setDetailsError(null);
    let checklistRevision = 0;
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [taskData, checklistsData, attachmentsData] = await Promise.all([
          getTask(projectId, taskId),
          getTaskChecklists(projectId, taskId),
          getTaskAttachments(projectId, taskId),
        ]);
        if (version !== scopeVersion.current) return;
        setTask(taskData);
        if (checklistRevision === 0) setChecklists(checklistsData);
        setAttachments(attachmentsData);
      } catch {
        if (version === scopeVersion.current) setDetailsError('説明・チェックリスト・添付の一部を取得できませんでした。');
      } finally {
        if (version === scopeVersion.current) setIsLoading(false);
      }
    };

    if (isE2EMockAuthEnabled()) {
      const sync = async () => {
        try {
          const { readTaskDetailsMock } = await import('@/lib/task/detailMock');
          const data = readTaskDetailsMock(projectId, taskId);
          if (version !== scopeVersion.current) return;
          if (userId) publishTaskCommentPresence({ userId, projectId, taskId }, data.comments.length > 0);
          setTask(data.task); setChecklists(data.checklists); setComments(data.comments); setAttachments(data.attachments); setCommentStatus('ready'); setIsLoading(false);
        } catch { if (version === scopeVersion.current) { setCommentStatus('error'); setDetailsError('隔離データを取得できません。'); } }
      };
      void sync(); window.addEventListener('taskflow-work-updated', sync); window.addEventListener('storage', sync);
      return () => { scopeVersion.current = version + 1; window.removeEventListener('taskflow-work-updated', sync); window.removeEventListener('storage', sync); };
    }
    fetchData();

    let lastChecklist: string | null = null;
    const unsubscribeChecklists = subscribeToTaskChecklists(projectId, taskId, lists => {
      if (version !== scopeVersion.current) return;
      checklistRevision++;
      setChecklists(lists);
      setDetailsError(previous => previous === 'チェックリストの最新情報を取得できません。' ? null : previous);
      const next = JSON.stringify(lists);
      if (lastChecklist !== null && next !== lastChecklist) window.dispatchEvent(new CustomEvent('taskflow-work-updated', { detail: { projectId, taskId } }));
      lastChecklist = next;
    }, () => { if (version === scopeVersion.current) { checklistRevision++; setDetailsError('チェックリストの最新情報を取得できません。'); } });

    let lastComments: string | null = null;
    // Subscribe to comments
    const unsubscribeComments = subscribeToTaskComments(projectId, taskId, (comments, source) => {
      if (version !== scopeVersion.current) return;
      if (userId) publishTaskCommentSnapshot({ userId, projectId, taskId }, comments.length, source?.fromCache);
      setComments(comments);
      setCommentStatus('ready');
      const next = JSON.stringify(comments);
      if (lastComments !== null && next !== lastComments) window.dispatchEvent(new CustomEvent('taskflow-work-updated', { detail: { projectId, taskId } }));
      lastComments = next;
    }, () => {
      if (version === scopeVersion.current) {
        setCommentStatus('error');
        if (userId) failTaskCommentPresence({ userId, projectId, taskId });
      }
    });

    // Subscribe to attachments
    const unsubscribeAttachments = subscribeToTaskAttachments(projectId, taskId, (attachments) => {
      if (version !== scopeVersion.current) return;
      setAttachments(attachments);
    });

    return () => {
      scopeVersion.current = version + 1;
      unsubscribeChecklists();
      unsubscribeComments();
      unsubscribeAttachments();
    };
  }, [projectId, taskId, userId]);

  const mockAction = useCallback(async (action: DetailMockAction) => {
    if (!projectId || !taskId) return;
    const version = scopeVersion.current;
    const { actTaskDetailsMock } = await import('@/lib/task/detailMock');
    const data = await actTaskDetailsMock(projectId, taskId, action);
    if (version === scopeVersion.current) { setChecklists(data.checklists); setComments(data.comments); setCommentStatus('ready'); }
  }, [projectId, taskId]);

  const moveChecklistItem = useCallback(async (checklistId: string, itemId: string, targetId: string) => {
    if (!projectId || !taskId) throw new Error('タスクを開き直してください。');
    if (isE2EMockAuthEnabled()) return mockAction({ kind: 'moveItem', id: checklistId, itemId, targetId });
    const version = scopeVersion.current;
    const items = await reorderChecklistItem(projectId, taskId, checklistId, itemId, targetId);
    if (version === scopeVersion.current) {
      setChecklists(previous => previous.map(checklist => checklist.id === checklistId ? { ...checklist, items } : checklist));
    }
  }, [projectId, taskId, mockAction]);

  // Add checklist
  const addChecklist = useCallback(
    async (title: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) { await mockAction({ kind: 'addChecklist', title }); return; }
      const maxOrder = Math.max(...checklists.map((c) => c.order), -1);
      const checklistId = await createChecklist(projectId, taskId, {
        title,
        order: maxOrder + 1,
        items: [],
      });

      // Refresh checklists
      const updated = await getTaskChecklists(projectId, taskId);
      setChecklists(updated);
      return checklistId;
    },
    [projectId, taskId, checklists, mockAction]
  );

  // Update checklist
  const editChecklist = useCallback(
    async (checklistId: string, data: Partial<Omit<Checklist, 'id' | 'taskId' | 'createdAt'>>) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) return mockAction({ kind: 'editChecklist', id: checklistId, data });
      const version = scopeVersion.current;
      await updateChecklist(projectId, taskId, checklistId, data);

      // Refresh checklists only while the original task/account is still open.
      const updated = await getTaskChecklists(projectId, taskId);
      if (version === scopeVersion.current) setChecklists(updated);
    },
    [projectId, taskId, mockAction]
  );

  // Delete checklist
  const removeChecklist = useCallback(
    async (checklistId: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) return mockAction({ kind: 'removeChecklist', id: checklistId });
      await deleteChecklist(projectId, taskId, checklistId);
      setChecklists((prev) => prev.filter((c) => c.id !== checklistId));
    },
    [projectId, taskId, mockAction]
  );

  const saveChecklistItem = useCallback(async (checklistId: string, action: ChecklistItemMutation) => {
    if (!projectId || !taskId) throw new Error('タスクを開き直してください。');
    const version = scopeVersion.current;
    if (isE2EMockAuthEnabled()) {
      if (action.kind === 'text') return mockAction({ kind: 'editItemText', id: checklistId, itemId: action.itemId, text: action.text, expectedText: action.expectedText });
      if (action.kind === 'deadline') return mockAction({ ...action, kind: 'setItemDeadline', id: checklistId });
      if (action.kind === 'dueDate') return mockAction({ kind: 'setItemDueDate', id: checklistId, itemId: action.itemId, dueDate: action.dueDate });
      if (action.kind === 'add') return mockAction({ kind: 'addItem', id: checklistId, itemId: action.item.id, text: action.item.text });
      if (action.kind === 'toggle') return mockAction({ kind: 'toggleItem', id: checklistId, itemId: action.itemId, isChecked: action.isChecked });
      return mockAction({ kind: 'removeItem', id: checklistId, itemId: action.itemId });
    }
    const items = await mutateChecklistItem(projectId, taskId, checklistId, action);
    window.dispatchEvent(new CustomEvent('taskflow-work-updated', { detail: { projectId, taskId } }));
    if (version === scopeVersion.current) {
      setChecklists(previous => previous.map(checklist => checklist.id === checklistId ? { ...checklist, items } : checklist));
    }
  }, [projectId, taskId, mockAction]);

  const setChecklistItemDeadline = useCallback(
    (checklistId: string, itemId: string, value: ChecklistDeadline) => saveChecklistItem(checklistId, { kind: 'deadline', itemId, ...value }),
    [saveChecklistItem]
  );

  const setChecklistItemDueDate = useCallback(
    (checklistId: string, itemId: string, dueDate: string | null) => saveChecklistItem(checklistId, { kind: 'dueDate', itemId, dueDate }),
    [saveChecklistItem]
  );

  const editChecklistItemText = useCallback(
    (checklistId: string, itemId: string, text: string, expectedText: string) => saveChecklistItem(checklistId, { kind: 'text', itemId, text, expectedText }),
    [saveChecklistItem]
  );

  // Item changes are applied to the latest shared checklist, preserving concurrent
  // deadlines, sibling additions, manual order and completion changes.
  const addChecklistItem = useCallback(
    (checklistId: string, text: string) => saveChecklistItem(checklistId, { kind: 'add', item: { id: crypto.randomUUID(), text } }),
    [saveChecklistItem]
  );
  const toggleChecklistItem = useCallback(async (checklistId: string, itemId: string) => {
    const item = checklists.find(checklist => checklist.id === checklistId)?.items.find(item => item.id === itemId);
    if (!item) throw new Error('項目が見つかりません。タスクを開き直してください。');
    await saveChecklistItem(checklistId, { kind: 'toggle', itemId, isChecked: !item.isChecked });
  }, [checklists, saveChecklistItem]);
  const removeChecklistItem = useCallback(
    (checklistId: string, itemId: string) => saveChecklistItem(checklistId, { kind: 'remove', itemId }),
    [saveChecklistItem]
  );

  // Add comment (with optional attachments)
  const addComment = useCallback(
    async (
      content: string,
      authorId: string,
      authorLabel?: string,
      mentions: string[] = [],
      files: File[] = []
    ) => {
      if (!projectId || !taskId) return;

      if (isE2EMockAuthEnabled()) {
        if (files.length) throw new Error('隔離環境ではファイルをアップロードしません。');
        return mockAction({ kind: 'addComment', content, authorId, authorLabel, mentions });
      }

      // Upload attachments first
      let commentAttachments: CommentAttachment[] = [];
      if (files.length > 0) {
        const uploadPromises = files.map((file) =>
          uploadCommentAttachment(projectId, taskId, file)
        );
        commentAttachments = await Promise.all(uploadPromises);
      }

      await createComment(projectId, taskId, {
        content,
        authorId,
        authorLabel,
        mentions,
        attachments: commentAttachments,
      });
    },
    [projectId, taskId, mockAction]
  );

  // Remove comment
  const removeComment = useCallback(
    async (commentId: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) return mockAction({ kind: 'removeComment', id: commentId });
      await deleteComment(projectId, taskId, commentId);
    },
    [projectId, taskId, mockAction]
  );

  // Edit comment
  const editComment = useCallback(
    async (commentId: string, content: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) return mockAction({ kind: 'editComment', id: commentId, content });
      await updateComment(projectId, taskId, commentId, content);
    },
    [projectId, taskId, mockAction]
  );

  // Get all comment attachments (for displaying at task top)
  const getAllCommentAttachments = useCallback(() => {
    const allAttachments: { commentId: string; attachment: CommentAttachment; createdAt: Date }[] = [];
    comments.forEach((comment) => {
      if (comment.attachments && comment.attachments.length > 0) {
        comment.attachments.forEach((att) => {
          allAttachments.push({
            commentId: comment.id,
            attachment: att,
            createdAt: comment.createdAt,
          });
        });
      }
    });
    return allAttachments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [comments]);

  // Upload attachment
  const uploadAttachment = useCallback(
    async (file: File, uploadedBy: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) throw new Error('隔離環境ではファイルをアップロードしません。');
      const fileData = await uploadFile(projectId, taskId, file);
      await createAttachment(projectId, taskId, {
        name: fileData.name,
        url: fileData.url,
        type: fileData.type,
        size: fileData.size,
        uploadedBy,
      });
    },
    [projectId, taskId]
  );

  // Remove attachment
  const removeAttachment = useCallback(
    async (attachmentId: string, fileName: string) => {
      if (!projectId || !taskId) return;
      if (isE2EMockAuthEnabled()) throw new Error('隔離環境ではファイルを削除しません。');
      await deleteAttachment(projectId, taskId, attachmentId);
      await deleteFile(projectId, taskId, fileName);
    },
    [projectId, taskId]
  );

  return {
    task,
    checklists,
    comments,
    commentStatus,
    detailsError,
    attachments,
    isLoading,
    addChecklist,
    editChecklist,
    removeChecklist,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    editChecklistItemText,
    moveChecklistItem,
    setChecklistItemDueDate,
    setChecklistItemDeadline,
    addComment,
    removeComment,
    editComment,
    getAllCommentAttachments,
    uploadAttachment,
    removeAttachment,
  };
}
