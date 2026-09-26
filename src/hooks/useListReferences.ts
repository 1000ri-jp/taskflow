'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ListReference, ListReferenceAttachment, ListReferenceLink } from '@/types';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { useAuthStore } from '@/stores/authStore';
import { mutateOrganizationMock, readOrganizationMock } from '@/lib/task/organizationMock';

export type ReferenceInput = {
  title: string;
  body: string;
  comment?: string;
  links?: ListReferenceLink[];
  attachments?: ListReferenceAttachment[];
  order?: number;
  sourceTaskId?: string;
  conversionId?: string;
};

export function isSafeReferenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function useListReferences(projectId: string | null, listId: string | null) {
  const mock = isE2EMockAuthEnabled();
  const userId = useAuthStore(state => state.user?.id ?? null);
  const [references, setReferences] = useState<ListReference[]>([]);
  const [archivedReferences, setArchivedReferences] = useState<ListReference[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(projectId && listId));
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!projectId || !listId) {
      setReferences([]);
      setArchivedReferences([]);
      setIsLoading(false);
      return;
    }
    let active = true;
    setIsLoading(true);
    setError(null);
    if (mock) {
      const demoRequested = new URLSearchParams(window.location.search).get('demo') === 'references';
      const read = () => {
        if (!active) return;
        try {
          const state = readOrganizationMock(projectId);
          const next = Object.values(state.data.references ?? {}).filter(reference => reference.projectId === projectId && reference.listId === listId).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'ja'));
          setReferences(next.filter(reference => !reference.isArchived));
          setArchivedReferences(next.filter(reference => reference.isArchived));
          setError(null);
        } catch (reason) {
          setError(reason instanceof Error ? reason : new Error('関連情報を取得できません。'));
        } finally {
          setIsLoading(false);
        }
      };
      window.addEventListener('taskflow-work-updated', read);
      window.addEventListener('storage', read);
      if (demoRequested) void import('@/lib/task/organizationMock').then(({ addReferenceDemoData }) => mutateOrganizationMock(projectId, work => { addReferenceDemoData(work.data); })).then(read).catch(() => read());
      else read();
      return () => { active = false; window.removeEventListener('taskflow-work-updated', read); window.removeEventListener('storage', read); };
    }
    let unsubscribe = () => {};
    void import('@/lib/firebase/firestore').then(({ subscribeToProjectReferences }) => {
      if (!active) return;
      unsubscribe = subscribeToProjectReferences(projectId, next => {
        if (!active) return;
        const scoped = next.filter(reference => reference.listId === listId);
        setReferences(scoped.filter(reference => !reference.isArchived));
        setArchivedReferences(scoped.filter(reference => reference.isArchived));
        setIsLoading(false);
        setError(null);
      }, reason => {
        if (!active) return;
        setError(reason);
        setIsLoading(false);
      });
    }).catch(reason => { if (active) { setError(reason instanceof Error ? reason : new Error('関連情報を取得できません。')); setIsLoading(false); } });
    return () => { active = false; unsubscribe(); };
  }, [listId, mock, projectId]);

  const create = useCallback(async (input: ReferenceInput) => {
    if (!projectId || !listId || !userId) throw new Error('関連情報の保存先を確認してください。');
    if (!input.title.trim()) throw new Error('タイトルを入力してください。');
    const links = input.links ?? [];
    if (links.some(link => !link.label.trim() || !isSafeReferenceUrl(link.url))) throw new Error('リンク名と安全なURLを確認してください。');
    if (mock) {
      const id = `reference-${crypto.randomUUID()}`;
      const now = new Date();
      await mutateOrganizationMock(projectId, work => {
        work.data.references ??= {};
        work.data.references[id] = { id, projectId, listId, title: input.title.trim(), body: input.body.trim(), comment: input.comment?.trim() ?? '', links: links.map(link => ({ ...link, id: link.id || `link-${crypto.randomUUID()}` })), attachments: input.attachments ?? [], order: input.order ?? Object.values(work.data.references).length + 1, createdBy: userId, createdAt: now, updatedBy: userId, updatedAt: now, isArchived: false, sourceTaskId: input.sourceTaskId, conversionId: input.conversionId };
      });
      return id;
    }
    const { createReference } = await import('@/lib/firebase/firestore');
    return createReference(projectId, { listId, title: input.title.trim(), body: input.body.trim(), comment: input.comment?.trim() ?? '', links, attachments: input.attachments ?? [], order: input.order ?? references.length + 1, createdBy: userId, updatedBy: userId, isArchived: false, sourceTaskId: input.sourceTaskId, conversionId: input.conversionId });
  }, [listId, mock, projectId, references.length, userId]);

  const update = useCallback(async (referenceId: string, patch: Partial<ReferenceInput>, expectedUpdatedAt?: Date) => {
    if (!projectId || !userId) throw new Error('関連情報の保存先を確認してください。');
    if (patch.links?.some(link => !link.label.trim() || !isSafeReferenceUrl(link.url))) throw new Error('リンク名と安全なURLを確認してください。');
    const normalizedPatch = {
      ...patch,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim() } : {}),
      ...(patch.comment !== undefined ? { comment: patch.comment.trim() } : {}),
    };
    if (mock) {
      await mutateOrganizationMock(projectId, work => {
        const current = work.data.references?.[referenceId];
        if (!current) throw new Error('関連情報が見つかりません。再読み込みしてください。');
        if (expectedUpdatedAt && Math.abs(new Date(current.updatedAt).getTime() - expectedUpdatedAt.getTime()) > 1000) throw new Error('他の人が更新しました。再読み込みしてから編集してください。');
        work.data.references![referenceId] = { ...current, ...normalizedPatch, updatedBy: userId, updatedAt: new Date() };
      });
      return;
    }
    const { updateReference } = await import('@/lib/firebase/firestore');
    await updateReference(projectId, referenceId, normalizedPatch, expectedUpdatedAt);
  }, [mock, projectId, userId]);

  const archive = useCallback(async (referenceId: string) => {
    if (!projectId || !userId) throw new Error('関連情報の保存先を確認してください。');
    if (mock) await mutateOrganizationMock(projectId, work => { const current = work.data.references?.[referenceId]; if (!current) throw new Error('関連情報が見つかりません。'); work.data.references![referenceId] = { ...current, isArchived: true, archivedAt: new Date(), archivedBy: userId, updatedAt: new Date(), updatedBy: userId }; });
    else { const { archiveReference } = await import('@/lib/firebase/firestore'); await archiveReference(projectId, referenceId, userId); }
  }, [mock, projectId, userId]);

  const restore = useCallback(async (referenceId: string) => {
    if (!projectId || !userId) throw new Error('関連情報の保存先を確認してください。');
    if (mock) await mutateOrganizationMock(projectId, work => { const current = work.data.references?.[referenceId]; if (!current) throw new Error('関連情報が見つかりません。'); work.data.references![referenceId] = { ...current, isArchived: false, archivedAt: null, archivedBy: null, updatedAt: new Date(), updatedBy: userId }; });
    else { const { restoreReference } = await import('@/lib/firebase/firestore'); await restoreReference(projectId, referenceId); }
  }, [mock, projectId, userId]);

  return { references, archivedReferences, isLoading, error, create, update, archive, restore };
}
