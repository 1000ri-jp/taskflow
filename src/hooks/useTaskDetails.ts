'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { reorderChecklistItem } from '@/lib/firebase/checklist-order';
import {
  getTask,
  getTaskChecklists,
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
import type { Task, Checklist, ChecklistItem, Comment, Attachment, CommentAttachment } from '@/types';

export function useTaskDetails(projectId: string | null, taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
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
      setAttachments([]);
      setIsLoading(false);
      return;
    }

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
        setChecklists(checklistsData);
        setAttachments(attachmentsData);
      } finally {
        if (version === scopeVersion.current) setIsLoading(false);
      }
    };

    fetchData();

    // Subscribe to comments
    const unsubscribeComments = subscribeToTaskComments(projectId, taskId, (comments) => {
      setComments(comments);
    });

    // Subscribe to attachments
    const unsubscribeAttachments = subscribeToTaskAttachments(projectId, taskId, (attachments) => {
      setAttachments(attachments);
    });

    return () => {
      scopeVersion.current = version + 1;
      unsubscribeComments();
      unsubscribeAttachments();
    };
  }, [projectId, taskId]);

  const moveChecklistItem = useCallback(async (checklistId: string, itemId: string, targetId: string) => {
    if (!projectId || !taskId) throw new Error('タスクを開き直してください。');
    const version = scopeVersion.current;
    const items = await reorderChecklistItem(projectId, taskId, checklistId, itemId, targetId);
    if (version === scopeVersion.current) {
      setChecklists(previous => previous.map(checklist => checklist.id === checklistId ? { ...checklist, items } : checklist));
    }
  }, [projectId, taskId]);

  // Add checklist
  const addChecklist = useCallback(
    async (title: string) => {
      if (!projectId || !taskId) return;
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
    [projectId, taskId, checklists]
  );

  // Update checklist
  const editChecklist = useCallback(
    async (checklistId: string, data: Partial<Omit<Checklist, 'id' | 'taskId' | 'createdAt'>>) => {
      if (!projectId || !taskId) return;
      await updateChecklist(projectId, taskId, checklistId, data);

      // Refresh checklists
      const updated = await getTaskChecklists(projectId, taskId);
      setChecklists(updated);
    },
    [projectId, taskId]
  );

  // Delete checklist
  const removeChecklist = useCallback(
    async (checklistId: string) => {
      if (!projectId || !taskId) return;
      await deleteChecklist(projectId, taskId, checklistId);
      setChecklists((prev) => prev.filter((c) => c.id !== checklistId));
    },
    [projectId, taskId]
  );

  // Add checklist item
  const addChecklistItem = useCallback(
    async (checklistId: string, text: string) => {
      if (!projectId || !taskId) return;
      const checklist = checklists.find((c) => c.id === checklistId);
      if (!checklist) return;

      const newItem: ChecklistItem = {
        id: crypto.randomUUID(),
        text,
        isChecked: false,
        order: checklist.items.length,
      };

      await updateChecklist(projectId, taskId, checklistId, {
        items: [...checklist.items, newItem],
      });

      // Refresh checklists
      const updated = await getTaskChecklists(projectId, taskId);
      setChecklists(updated);
    },
    [projectId, taskId, checklists]
  );

  // Toggle checklist item
  const toggleChecklistItem = useCallback(
    async (checklistId: string, itemId: string) => {
      if (!projectId || !taskId) return;
      const checklist = checklists.find((c) => c.id === checklistId);
      if (!checklist) return;

      const updatedItems = checklist.items.map((item) =>
        item.id === itemId ? { ...item, isChecked: !item.isChecked } : item
      );

      await updateChecklist(projectId, taskId, checklistId, {
        items: updatedItems,
      });

      // Optimistic update
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === checklistId ? { ...c, items: updatedItems } : c
        )
      );
    },
    [projectId, taskId, checklists]
  );

  // Delete checklist item
  const removeChecklistItem = useCallback(
    async (checklistId: string, itemId: string) => {
      if (!projectId || !taskId) return;
      const checklist = checklists.find((c) => c.id === checklistId);
      if (!checklist) return;

      const updatedItems = checklist.items.filter((item) => item.id !== itemId);

      await updateChecklist(projectId, taskId, checklistId, {
        items: updatedItems,
      });

      // Optimistic update
      setChecklists((prev) =>
        prev.map((c) =>
          c.id === checklistId ? { ...c, items: updatedItems } : c
        )
      );
    },
    [projectId, taskId, checklists]
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
    [projectId, taskId]
  );

  // Remove comment
  const removeComment = useCallback(
    async (commentId: string) => {
      if (!projectId || !taskId) return;
      await deleteComment(projectId, taskId, commentId);
    },
    [projectId, taskId]
  );

  // Edit comment
  const editComment = useCallback(
    async (commentId: string, content: string) => {
      if (!projectId || !taskId) return;
      await updateComment(projectId, taskId, commentId, content);
    },
    [projectId, taskId]
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
      await deleteAttachment(projectId, taskId, attachmentId);
      await deleteFile(projectId, taskId, fileName);
    },
    [projectId, taskId]
  );

  return {
    task,
    checklists,
    comments,
    attachments,
    isLoading,
    addChecklist,
    editChecklist,
    removeChecklist,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    moveChecklistItem,
    addComment,
    removeComment,
    editComment,
    getAllCommentAttachments,
    uploadAttachment,
    removeAttachment,
  };
}
