'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/authStore';
import {
  createProject,
  subscribeToProject,
  updateProject,
  deleteProject,
  archiveProject,
  subscribeToUserProjects,
  subscribeToArchivedUserProjects,
  reorderUserProjects,
  getProjectMembers,
  addProjectMember,
  removeProjectMember,
  updateMemberRole,
} from '@/lib/firebase/firestore';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import type { Project, ProjectMember, ProjectRole, ProjectUrl } from '@/types';
import { useOrganizationLabTasks } from './useOrganizationLabTasks';

export function useProjects(enabled = true) {
  const { firebaseUser } = useAuthStore();
  const userId = firebaseUser?.uid ?? null;
  const [stateUserId, setStateUserId] = useState(userId);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Discard the previous account's list and late callbacks before allowing a reorder.
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    if (!enabled) {
      return () => { active = false; unsubscribe?.(); };
    }
    Promise.resolve().then(() => {
      if (!active) return;
      setStateUserId(userId);
      setProjects([]);
      setError(null);
      if (!userId || isE2EMockAuthEnabled()) { setIsLoading(false); return; }
      setIsLoading(true);
      unsubscribe = subscribeToUserProjects(userId, next => {
        if (!active) return;
        setProjects(next);
        setIsLoading(false);
        setError(null);
      }, err => {
        if (!active) return;
        setError(err);
        setIsLoading(false);
      });
    });
    return () => { active = false; unsubscribe?.(); };
  }, [enabled, userId]);

  // Create project
  const create = useCallback(
    async (data: { name: string; description: string; color: string; icon: string; defaultAssigneeId?: string | null }) => {
      if (!firebaseUser) throw new Error('Not authenticated');

      try {
        const projectId = await createProject(
          {
            name: data.name,
            description: data.description,
            color: data.color,
            icon: data.icon,
            defaultAssigneeId: data.defaultAssigneeId ?? null,
            ownerId: firebaseUser.uid,
            memberIds: [firebaseUser.uid],
            isArchived: false,
            order: projects.length,
          },
          firebaseUser.uid
        );
        return projectId;
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [firebaseUser, projects.length]
  );

  // Update project
  const update = useCallback(
    async (
      projectId: string,
      data: Partial<{ name: string; description: string; color: string; icon: string; iconUrl?: string; headerImageUrl?: string; defaultAssigneeId?: string | null; urls?: ProjectUrl[] }>
    ) => {
      try {
        await updateProject(projectId, data);
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    []
  );

  // Delete project
  const remove = useCallback(async (projectId: string) => {
    try {
      await deleteProject(projectId);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  // Archive project
  const archive = useCallback(async (projectId: string, isArchived: boolean) => {
    try {
      await archiveProject(projectId, isArchived);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  // Each account owns its display order; all mounted lists receive the saved update.
  const reorder = useCallback(async (projectIds: string[]) => {
    if (!userId || stateUserId !== userId || isLoading || error) throw new Error('一覧の取得後に並べ替えてください。');
    if (projectIds.length !== projects.length || projectIds.some(id => !projects.some(project => project.id === id))) throw new Error('プロジェクトの一覧が変わりました。');
    try {
      await reorderUserProjects(userId, projectIds);
    } catch (err) {
      if (useAuthStore.getState().firebaseUser?.uid === userId) setError(err as Error);
      throw err;
    }
  }, [userId, stateUserId, isLoading, error, projects]);

  const isCurrentUser = stateUserId === userId;
  return {
    projects: isCurrentUser ? projects : [],
    isLoading: isCurrentUser ? isLoading : !!userId,
    error: isCurrentUser ? error : null,
    create,
    update,
    remove,
    archive,
    reorder,
  };
}

export function useArchivedProjects() {
  const { firebaseUser } = useAuthStore();
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to user's archived projects
  useEffect(() => {
    if (isE2EMockAuthEnabled()) {
      Promise.resolve().then(() => {
        setArchivedProjects([]);
        setIsLoading(false);
        setError(null);
      });
      return;
    }

    if (!firebaseUser) {
      Promise.resolve().then(() => {
        setArchivedProjects([]);
        setIsLoading(false);
      });
      return;
    }

    Promise.resolve().then(() => {
      setIsLoading(true);
      setError(null);
    });
    const unsubscribe = subscribeToArchivedUserProjects(
      firebaseUser.uid,
      (projects) => {
        setArchivedProjects(projects);
        setIsLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[useArchivedProjects] Error:', err);
        setError(err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firebaseUser]);

  // Restore (unarchive) project
  const restore = useCallback(async (projectId: string) => {
    try {
      await archiveProject(projectId, false);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, []);

  return {
    archivedProjects,
    isLoading,
    error,
    restore,
  };
}

export function useProject(projectId: string | null, refreshKey = 0) {
  const mock = isE2EMockAuthEnabled();
  const userId = useAuthStore(s => s.user?.id ?? null);
  const lab = useOrganizationLabTasks(mock, userId);
  const [stateProjectId, setStateProjectId] = useState(projectId);
  const [project, setProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Subscribe to project for real-time updates
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    Promise.resolve().then(() => {
      if (!active) return;
      setStateProjectId(projectId);
      setProject(null);
      setMembers([]);
      setError(null);
      if (isE2EMockAuthEnabled() || !projectId) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);

      getProjectMembers(projectId)
        .then((nextMembers) => { if (active) setMembers(nextMembers); })
        .catch((err) => { if (active) console.error('[useProject] Error fetching members:', err); });

      unsubscribe = subscribeToProject(
        projectId,
        (projectData) => {
          if (!active) return;
          setProject(projectData);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          if (!active) return;
          console.error('[useProject] Error:', err);
          setError(err);
          setIsLoading(false);
        }
      );
    });

    return () => { active = false; unsubscribe?.(); };
  }, [projectId, refreshKey]);

  // Update project (real-time subscription will handle state updates)
  const update = useCallback(
    async (data: Partial<{ name: string; description: string; color: string; icon: string; iconUrl?: string | null; headerImageUrl?: string | null; defaultAssigneeId?: string | null; urls?: ProjectUrl[] }>) => {
      if (!projectId) return;
      try {
        await updateProject(projectId, data);
        // State will be automatically updated via subscribeToProject
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [projectId]
  );

  // Archive project (real-time subscription will handle state updates)
  const archive = useCallback(async () => {
    if (!projectId) return;
    try {
      await archiveProject(projectId, true);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, [projectId]);

  // Delete an archived project
  const remove = useCallback(async () => {
    if (!projectId) return;
    try {
      await deleteProject(projectId);
    } catch (err) {
      setError(err as Error);
      throw err;
    }
  }, [projectId]);

  // Add member
  const addMember = useCallback(
    async (userId: string, role: ProjectRole) => {
      if (!projectId) return;
      try {
        await addProjectMember(projectId, userId, role);
        const updatedMembers = await getProjectMembers(projectId);
        setMembers(updatedMembers);
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [projectId]
  );

  // Remove member
  const removeMember = useCallback(
    async (memberId: string, userId: string) => {
      if (!projectId) return;
      try {
        await removeProjectMember(projectId, memberId, userId);
        setMembers((prev) => prev.filter((m) => m.userId !== userId));
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [projectId]
  );

  // Update member role
  const updateRole = useCallback(
    async (memberId: string, role: ProjectRole) => {
      if (!projectId) return;
      try {
        await updateMemberRole(projectId, memberId, role);
        setMembers((prev) =>
          prev.map((m) => (m.userId === memberId ? { ...m, role } : m))
        );
      } catch (err) {
        setError(err as Error);
        throw err;
      }
    },
    [projectId]
  );

  const isCurrentProject = stateProjectId === projectId;
  if (mock) {
    const project = lab.projects.find(p => p.id === projectId) ?? null;
    const unsupported = async () => { throw new Error('プロジェクト設定はこの隔離作業台では変更しません。'); };
    return { project, members: project?.memberIds.map(userId => ({ id: userId, userId, role: 'editor' as const, joinedAt: new Date(0) })) ?? [],
      isLoading: lab.isLoading, error: lab.error, update: async (patch: { defaultAssigneeId?: string | null }) => {
        if (!projectId || !project || Object.keys(patch).some(key => key !== 'defaultAssigneeId')) return unsupported();
        const { mutateOrganizationMock } = await import('@/lib/task/organizationMock');
        await mutateOrganizationMock(projectId, work => {
          if (patch.defaultAssigneeId && !work.data.memberIds.includes(patch.defaultAssigneeId)) throw new Error('主担当はメンバーから選んでください。');
          work.data.defaultAssigneeId = patch.defaultAssigneeId ?? null;
        });
      }, archive: unsupported, remove: unsupported, addMember: unsupported, removeMember: unsupported, updateRole: unsupported };
  }
  return {
    project: isCurrentProject ? project : null,
    members: isCurrentProject ? members : [],
    isLoading: isCurrentProject ? isLoading : !!projectId,
    error: isCurrentProject ? error : null,
    update,
    archive,
    remove,
    addMember,
    removeMember,
    updateRole,
  };
}
