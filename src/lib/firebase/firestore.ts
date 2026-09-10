import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  Timestamp,
  documentId,
  limit as firestoreLimit,
  type DocumentData,
} from 'firebase/firestore';
import { getFirebaseDb } from './config';
import type {
  Project,
  ProjectMember,
  List,
  Task,
  Label,
  Tag,
  Comment,
  Checklist,
  Attachment,
  User,
  Notification,
  ActivityLog,
  Milestone,
  MilestoneStatus,
} from '@/types';
import { DEFAULT_TAGS } from '@/types';

// Helper to convert Firestore timestamp to Date
function toDate(timestamp: Timestamp | null | undefined): Date {
  return timestamp?.toDate() || new Date();
}

// Helper to convert document to typed object
function convertDoc<T>(doc: DocumentData, id: string): T {
  const data = doc;
  return {
    ...data,
    id,
    // Convert empty string iconUrl/headerImageUrl to undefined
    iconUrl: data.iconUrl || undefined,
    headerImageUrl: data.headerImageUrl || undefined,
    // Default values for List fields (for backward compatibility)
    autoCompleteOnEnter: data.autoCompleteOnEnter ?? false,
    autoUncompleteOnExit: data.autoUncompleteOnExit ?? false,
    autoSetStartDateOnEnter: data.autoSetStartDateOnEnter ?? false,
    // Default values for Task fields (for backward compatibility)
    completedAt: data.completedAt ? toDate(data.completedAt) : null,
    isAbandoned: data.isAbandoned ?? false,
    dependsOnTaskIds: data.dependsOnTaskIds ?? [],
    isDueDateFixed: data.isDueDateFixed ?? false, // Default: duration優先
    // Default values for Project fields (for backward compatibility)
    order: data.order ?? 0,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as T;
}

function omitUndefinedFields<T extends Record<string, unknown>>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as T;
}

// ==================== Projects ====================

export async function createProject(
  data: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>,
  userId: string
): Promise<string> {
  const db = getFirebaseDb();
  const projectRef = await addDoc(collection(db, 'projects'), {
    ...data,
    ownerId: userId,
    memberIds: [userId],
    isArchived: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Add owner as admin member
  await addDoc(collection(db, 'projects', projectRef.id, 'members'), {
    userId,
    role: 'admin',
    joinedAt: serverTimestamp(),
  });

  // Create default labels
  const defaultLabels = [
    { name: '高優先', color: '#ef4444' },
    { name: '中優先', color: '#f59e0b' },
    { name: '低優先', color: '#6b7280' },
    { name: 'バグ', color: '#dc2626' },
    { name: '機能', color: '#3b82f6' },
  ];

  const batch = writeBatch(db);
  defaultLabels.forEach((label) => {
    const labelRef = doc(collection(db, 'projects', projectRef.id, 'labels'));
    batch.set(labelRef, {
      ...label,
      createdAt: serverTimestamp(),
    });
  });

  // Create default tags
  DEFAULT_TAGS.forEach((tag, index) => {
    const tagRef = doc(collection(db, 'projects', projectRef.id, 'tags'));
    batch.set(tagRef, {
      ...tag,
      order: index,
      createdAt: serverTimestamp(),
    });
  });

  await batch.commit();

  return projectRef.id;
}

export async function getProject(projectId: string): Promise<Project | null> {
  const db = getFirebaseDb();
  const projectDoc = await getDoc(doc(db, 'projects', projectId));

  if (!projectDoc.exists()) {
    return null;
  }

  return convertDoc<Project>(projectDoc.data(), projectDoc.id);
}

// Subscribe to a single project for real-time updates
export function subscribeToProject(
  projectId: string,
  callback: (project: Project | null) => void,
  onError?: (error: Error) => void
): () => void {
  const db = getFirebaseDb();
  const projectRef = doc(db, 'projects', projectId);

  return onSnapshot(
    projectRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback(convertDoc<Project>(snapshot.data(), snapshot.id));
    },
    (error) => {
      console.error('[subscribeToProject] Error:', error);
      onError?.(error);
    }
  );
}

// Type for update data where optional fields can be null (to clear them)
type ProjectUpdateData = Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'iconUrl' | 'headerImageUrl' | 'urls'>> & {
  iconUrl?: string | null;
  headerImageUrl?: string | null;
  urls?: Project['urls'] | null;
};

export async function updateProject(
  projectId: string,
  data: ProjectUpdateData
): Promise<void> {
  const db = getFirebaseDb();
  // Convert null values to empty string for iconUrl (more reliable than deleteField)
  const processedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === null) {
      // Use empty string instead of deleteField for better compatibility
      processedData[key] = '';
    } else if (value !== undefined) {
      processedData[key] = value;
    }
  }
  await updateDoc(doc(db, 'projects', projectId), {
    ...processedData,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  const db = getFirebaseDb();
  const projectRef = doc(db, 'projects', projectId);
  const projectSnapshot = await getDoc(projectRef);

  if (projectSnapshot.exists() && projectSnapshot.data().isArchived !== true) {
    throw new Error('プロジェクトを削除するには先にアーカイブしてください');
  }

  // Note: In production, use Cloud Functions to cascade delete subcollections
  await deleteDoc(projectRef);
}

export async function archiveProject(
  projectId: string,
  isArchived: boolean
): Promise<void> {
  await updateProject(projectId, { isArchived });
}

export async function getUserProjects(userId: string): Promise<Project[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects'),
    where('memberIds', 'array-contains', userId),
    where('isArchived', '==', false),
    orderBy('updatedAt', 'desc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertDoc<Project>(doc.data(), doc.id));
}

export function subscribeToUserProjects(
  userId: string,
  callback: (projects: Project[]) => void,
  onError?: (error: Error) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects'),
    where('memberIds', 'array-contains', userId),
    where('isArchived', '==', false)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const projects = snapshot.docs
        .map((doc) => convertDoc<Project>(doc.data(), doc.id))
        .sort((a, b) => a.order - b.order); // Sort by order
      callback(projects);
    },
    (error) => {
      console.error('[Firestore] subscribeToUserProjects error:', error);
      if (onError) {
        onError(error);
      }
    }
  );
}

export function subscribeToArchivedUserProjects(
  userId: string,
  callback: (projects: Project[]) => void,
  onError?: (error: Error) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects'),
    where('memberIds', 'array-contains', userId),
    where('isArchived', '==', true)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const projects = snapshot.docs
        .map((doc) => convertDoc<Project>(doc.data(), doc.id))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      callback(projects);
    },
    (error) => {
      console.error('[Firestore] subscribeToArchivedUserProjects error:', error);
      if (onError) {
        onError(error);
      }
    }
  );
}

export async function updateProjectOrder(projectId: string, order: number): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId), {
    order,
    updatedAt: serverTimestamp(),
  });
}

export async function reorderProjects(projectIds: string[]): Promise<void> {
  const db = getFirebaseDb();
  const batch = writeBatch(db);

  projectIds.forEach((projectId, index) => {
    const projectRef = doc(db, 'projects', projectId);
    batch.update(projectRef, { order: index });
  });

  await batch.commit();
}

// ==================== Project Members ====================

export async function addProjectMember(
  projectId: string,
  userId: string,
  role: 'admin' | 'editor' | 'viewer'
): Promise<void> {
  const db = getFirebaseDb();

  // Add to members subcollection
  await addDoc(collection(db, 'projects', projectId, 'members'), {
    userId,
    role,
    joinedAt: serverTimestamp(),
  });

  // Update memberIds array
  const project = await getProject(projectId);
  if (project && !project.memberIds.includes(userId)) {
    await updateDoc(doc(db, 'projects', projectId), {
      memberIds: [...project.memberIds, userId],
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateMemberRole(
  projectId: string,
  memberId: string,
  role: 'admin' | 'editor' | 'viewer'
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'members', memberId), {
    role,
  });
}

export async function removeProjectMember(
  projectId: string,
  memberId: string,
  userId: string
): Promise<void> {
  const db = getFirebaseDb();

  // Remove from members subcollection
  await deleteDoc(doc(db, 'projects', projectId, 'members', memberId));

  // Update memberIds array
  const project = await getProject(projectId);
  if (project) {
    await updateDoc(doc(db, 'projects', projectId), {
      memberIds: project.memberIds.filter((id) => id !== userId),
      updatedAt: serverTimestamp(),
    });
  }
}

export async function getProjectMembers(
  projectId: string
): Promise<ProjectMember[]> {
  const db = getFirebaseDb();
  const snapshot = await getDocs(
    collection(db, 'projects', projectId, 'members')
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    userId: doc.data().userId,
    role: doc.data().role,
    joinedAt: toDate(doc.data().joinedAt),
  })) as ProjectMember[];
}

// ==================== Lists ====================

export async function createList(
  projectId: string,
  data: Omit<List, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const listRef = await addDoc(collection(db, 'projects', projectId, 'lists'), {
    ...data,
    projectId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return listRef.id;
}

export async function updateList(
  projectId: string,
  listId: string,
  data: Partial<Omit<List, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'lists', listId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteList(
  projectId: string,
  listId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'lists', listId));
}

export async function getProjectLists(projectId: string): Promise<List[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'lists'),
    orderBy('order', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertDoc<List>(doc.data(), doc.id));
}

export function subscribeToProjectLists(
  projectId: string,
  callback: (lists: List[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'lists'),
    orderBy('order', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const lists = snapshot.docs.map((doc) =>
      convertDoc<List>(doc.data(), doc.id)
    );
    callback(lists);
  });
}

// ==================== Tasks ====================

export async function createTask(
  projectId: string,
  data: Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const taskRef = await addDoc(collection(db, 'projects', projectId, 'tasks'), {
    ...data,
    projectId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return taskRef.id;
}

export async function updateTask(
  projectId: string,
  taskId: string,
  data: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Archive a task (soft delete) - task is hidden but can be restored
 */
export async function archiveTask(
  projectId: string,
  taskId: string,
  userId: string
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
    isArchived: true,
    archivedAt: serverTimestamp(),
    archivedBy: userId,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Restore an archived task
 */
export async function restoreTask(
  projectId: string,
  taskId: string
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId), {
    isArchived: false,
    archivedAt: null,
    archivedBy: null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Permanently delete a task (use with caution - prefer archiveTask)
 */
export async function deleteTask(
  projectId: string,
  taskId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'tasks', taskId));
}

export async function getTask(
  projectId: string,
  taskId: string
): Promise<Task | null> {
  const db = getFirebaseDb();
  const taskDoc = await getDoc(
    doc(db, 'projects', projectId, 'tasks', taskId)
  );

  if (!taskDoc.exists()) {
    return null;
  }

  const data = taskDoc.data();
  return {
    ...convertDoc<Task>(data, taskDoc.id),
    startDate: data.startDate ? toDate(data.startDate) : null,
    dueDate: data.dueDate ? toDate(data.dueDate) : null,
  };
}

export async function getProjectTasks(projectId: string): Promise<Task[]> {
  const db = getFirebaseDb();
  const snapshot = await getDocs(
    collection(db, 'projects', projectId, 'tasks')
  );

  return snapshot.docs
    .map((doc) => {
      const data = doc.data();
      return {
        ...convertDoc<Task>(data, doc.id),
        startDate: data.startDate ? toDate(data.startDate) : null,
        dueDate: data.dueDate ? toDate(data.dueDate) : null,
      };
    })
    .filter((task) => !task.isArchived); // Filter out archived tasks
}

export function subscribeToProjectTasks(
  projectId: string,
  callback: (tasks: Task[]) => void,
  onError?: (error: Error) => void
): () => void {
  const db = getFirebaseDb();

  return onSnapshot(
    collection(db, 'projects', projectId, 'tasks'),
    (snapshot) => {
      const tasks = snapshot.docs
        .map((doc) => {
          const data = doc.data();
          return {
            ...convertDoc<Task>(data, doc.id),
            startDate: data.startDate ? toDate(data.startDate) : null,
            dueDate: data.dueDate ? toDate(data.dueDate) : null,
          };
        })
        .filter((task) => !task.isArchived); // Filter out archived tasks
      callback(tasks);
    },
    onError
  );
}

// ==================== Milestones ====================

export async function createMilestone(
  projectId: string,
  data: Omit<Milestone, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const milestoneRef = await addDoc(collection(db, 'projects', projectId, 'milestones'), {
    ...data,
    projectId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return milestoneRef.id;
}

export async function updateMilestone(
  projectId: string,
  milestoneId: string,
  data: Partial<Omit<Milestone, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'milestones', milestoneId), {
    ...omitUndefinedFields(data as Record<string, unknown>),
    updatedAt: serverTimestamp(),
  });
}

export async function deleteMilestone(projectId: string, milestoneId: string): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'milestones', milestoneId));
}

function convertMilestone(data: DocumentData, id: string): Milestone {
  const statuses: MilestoneStatus[] = ['planned', 'in_progress', 'achieved', 'cancelled'];
  const status = statuses.includes(data.status) ? data.status : 'planned';
  return {
    ...convertDoc<Milestone>(data, id),
    description: data.description ?? '',
    status,
    order: data.order ?? 0,
    achievedAt: data.achievedAt ? toDate(data.achievedAt) : null,
    createdBy: data.createdBy ?? '',
    dueDate: data.dueDate ? toDate(data.dueDate) : null,
  };
}

export async function getProjectMilestones(projectId: string): Promise<Milestone[]> {
  const db = getFirebaseDb();
  const snapshot = await getDocs(query(collection(db, 'projects', projectId, 'milestones'), orderBy('order', 'asc')));
  return snapshot.docs.map((snapshotDoc) => convertMilestone(snapshotDoc.data(), snapshotDoc.id));
}

export function subscribeToProjectMilestones(
  projectId: string,
  callback: (milestones: Milestone[]) => void,
  onError?: (error: Error) => void
): () => void {
  const db = getFirebaseDb();
  const milestonesQuery = query(collection(db, 'projects', projectId, 'milestones'), orderBy('order', 'asc'));
  return onSnapshot(milestonesQuery, (snapshot) => {
    callback(snapshot.docs.map((snapshotDoc) => convertMilestone(snapshotDoc.data(), snapshotDoc.id)));
  }, onError);
}

/**
 * Get archived tasks for a project
 */
export async function getArchivedTasks(projectId: string): Promise<Task[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks'),
    where('isArchived', '==', true),
    orderBy('archivedAt', 'desc')
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      ...convertDoc<Task>(data, doc.id),
      startDate: data.startDate ? toDate(data.startDate) : null,
      dueDate: data.dueDate ? toDate(data.dueDate) : null,
      archivedAt: data.archivedAt ? toDate(data.archivedAt) : null,
    };
  });
}

/**
 * Subscribe to archived tasks for a project
 */
export function subscribeToArchivedTasks(
  projectId: string,
  callback: (tasks: Task[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks'),
    where('isArchived', '==', true),
    orderBy('archivedAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const tasks = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        ...convertDoc<Task>(data, doc.id),
        startDate: data.startDate ? toDate(data.startDate) : null,
        dueDate: data.dueDate ? toDate(data.dueDate) : null,
        archivedAt: data.archivedAt ? toDate(data.archivedAt) : null,
      };
    });
    callback(tasks);
  });
}

// ==================== Labels ====================

export async function createLabel(
  projectId: string,
  data: Omit<Label, 'id' | 'projectId' | 'createdAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const labelRef = await addDoc(
    collection(db, 'projects', projectId, 'labels'),
    {
      ...data,
      projectId,
      createdAt: serverTimestamp(),
    }
  );
  return labelRef.id;
}

export async function updateLabel(
  projectId: string,
  labelId: string,
  data: Partial<Omit<Label, 'id' | 'projectId' | 'createdAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'labels', labelId), data);
}

export async function deleteLabel(
  projectId: string,
  labelId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'labels', labelId));
}

export async function getProjectLabels(projectId: string): Promise<Label[]> {
  const db = getFirebaseDb();
  const snapshot = await getDocs(
    collection(db, 'projects', projectId, 'labels')
  );

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    projectId,
    ...doc.data(),
    createdAt: toDate(doc.data().createdAt),
  })) as Label[];
}

export function subscribeToProjectLabels(
  projectId: string,
  callback: (labels: Label[]) => void
): () => void {
  const db = getFirebaseDb();

  return onSnapshot(
    collection(db, 'projects', projectId, 'labels'),
    (snapshot) => {
      const labels = snapshot.docs.map((doc) => ({
        id: doc.id,
        projectId,
        ...doc.data(),
        createdAt: toDate(doc.data().createdAt),
      })) as Label[];
      callback(labels);
    }
  );
}

// ==================== Tags ====================

export async function createTag(
  projectId: string,
  data: Omit<Tag, 'id' | 'projectId' | 'createdAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const tagRef = await addDoc(
    collection(db, 'projects', projectId, 'tags'),
    {
      ...data,
      projectId,
      createdAt: serverTimestamp(),
    }
  );
  return tagRef.id;
}

export async function updateTag(
  projectId: string,
  tagId: string,
  data: Partial<Omit<Tag, 'id' | 'projectId' | 'createdAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'tags', tagId), data);
}

export async function deleteTag(
  projectId: string,
  tagId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'tags', tagId));
}

export async function getProjectTags(projectId: string): Promise<Tag[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tags'),
    orderBy('order', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    projectId,
    ...doc.data(),
    createdAt: toDate(doc.data().createdAt),
  })) as Tag[];
}

export function subscribeToProjectTags(
  projectId: string,
  callback: (tags: Tag[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tags'),
    orderBy('order', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const tags = snapshot.docs.map((doc) => ({
      id: doc.id,
      projectId,
      ...doc.data(),
      createdAt: toDate(doc.data().createdAt),
    })) as Tag[];
    callback(tags);
  });
}

// ==================== Comments ====================

export async function createComment(
  projectId: string,
  taskId: string,
  data: Omit<Comment, 'id' | 'taskId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const commentRef = await addDoc(
    collection(db, 'projects', projectId, 'tasks', taskId, 'comments'),
    omitUndefinedFields({
      content: data.content,
      authorId: data.authorId,
      authorLabel: data.authorLabel,
      authorIcon: data.authorIcon ?? null,
      mentions: data.mentions || [],
      attachments: data.attachments || [],
      taskId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );
  return commentRef.id;
}

export async function getTaskComments(
  projectId: string,
  taskId: string
): Promise<Comment[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks', taskId, 'comments'),
    orderBy('createdAt', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => convertDoc<Comment>(doc.data(), doc.id));
}

// Read-only dashboard preview. Fetching N per task is enough to find the
// newest N comments across projects without downloading entire histories.
export async function getRecentTaskComments(projectId: string, taskId: string, count = 10): Promise<Comment[]> {
  const snapshot = await getDocs(query(
    collection(getFirebaseDb(), 'projects', projectId, 'tasks', taskId, 'comments'),
    orderBy('createdAt', 'desc'),
    firestoreLimit(count)
  ));
  return snapshot.docs.map((doc) => convertDoc<Comment>(doc.data(), doc.id));
}

export function subscribeToTaskComments(
  projectId: string,
  taskId: string,
  callback: (comments: Comment[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks', taskId, 'comments'),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const comments = snapshot.docs.map((doc) =>
      convertDoc<Comment>(doc.data(), doc.id)
    );
    callback(comments);
  });
}

export async function deleteComment(
  projectId: string,
  taskId: string,
  commentId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'projects', projectId, 'tasks', taskId, 'comments', commentId));
}

export async function updateComment(
  projectId: string,
  taskId: string,
  commentId: string,
  content: string
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'projects', projectId, 'tasks', taskId, 'comments', commentId), {
    content,
    updatedAt: serverTimestamp(),
  });
}

// ==================== Checklists ====================

export async function createChecklist(
  projectId: string,
  taskId: string,
  data: Omit<Checklist, 'id' | 'taskId' | 'createdAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const checklistRef = await addDoc(
    collection(db, 'projects', projectId, 'tasks', taskId, 'checklists'),
    {
      ...data,
      taskId,
      createdAt: serverTimestamp(),
    }
  );
  return checklistRef.id;
}

export async function updateChecklist(
  projectId: string,
  taskId: string,
  checklistId: string,
  data: Partial<Omit<Checklist, 'id' | 'taskId' | 'createdAt'>>
): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(
    doc(db, 'projects', projectId, 'tasks', taskId, 'checklists', checklistId),
    data
  );
}

export async function deleteChecklist(
  projectId: string,
  taskId: string,
  checklistId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(
    doc(db, 'projects', projectId, 'tasks', taskId, 'checklists', checklistId)
  );
}

export async function getTaskChecklists(
  projectId: string,
  taskId: string
): Promise<Checklist[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks', taskId, 'checklists'),
    orderBy('order', 'asc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    taskId,
    ...doc.data(),
    createdAt: toDate(doc.data().createdAt),
  })) as Checklist[];
}

// ==================== Attachments ====================

export async function createAttachment(
  projectId: string,
  taskId: string,
  data: Omit<Attachment, 'id' | 'taskId' | 'uploadedAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const attachmentRef = await addDoc(
    collection(db, 'projects', projectId, 'tasks', taskId, 'attachments'),
    {
      ...data,
      taskId,
      uploadedAt: serverTimestamp(),
    }
  );
  return attachmentRef.id;
}

export async function deleteAttachment(
  projectId: string,
  taskId: string,
  attachmentId: string
): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(
    doc(db, 'projects', projectId, 'tasks', taskId, 'attachments', attachmentId)
  );
}

export async function getTaskAttachments(
  projectId: string,
  taskId: string
): Promise<Attachment[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks', taskId, 'attachments'),
    orderBy('uploadedAt', 'desc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    taskId,
    ...doc.data(),
    uploadedAt: toDate(doc.data().uploadedAt),
  })) as Attachment[];
}

export function subscribeToTaskAttachments(
  projectId: string,
  taskId: string,
  callback: (attachments: Attachment[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'tasks', taskId, 'attachments'),
    orderBy('uploadedAt', 'desc')
  );

  return onSnapshot(q, (snapshot) => {
    const attachments = snapshot.docs.map((doc) => ({
      id: doc.id,
      taskId,
      ...doc.data(),
      uploadedAt: toDate(doc.data().uploadedAt),
    })) as Attachment[];
    callback(attachments);
  });
}

// ==================== Users ====================

export async function getAllUsers(): Promise<User[]> {
  const db = getFirebaseDb();
  const snapshot = await getDocs(collection(db, 'users'));
  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      displayName: data.displayName,
      email: data.email,
      photoURL: data.photoURL,
      createdAt: toDate(data.createdAt),
      updatedAt: toDate(data.updatedAt),
    } as User;
  });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const db = getFirebaseDb();
  const normalizedEmail = email.toLowerCase().trim();

  // First try exact match
  let q = query(collection(db, 'users'), where('email', '==', normalizedEmail));
  let snapshot = await getDocs(q);

  // If not found, try original email (in case stored with different case)
  if (snapshot.empty) {
    q = query(collection(db, 'users'), where('email', '==', email.trim()));
    snapshot = await getDocs(q);
  }

  // If still not found, search all users and compare case-insensitively
  if (snapshot.empty) {
    const allUsersSnapshot = await getDocs(collection(db, 'users'));
    const matchingDoc = allUsersSnapshot.docs.find(
      (doc) => doc.data().email?.toLowerCase() === normalizedEmail
    );
    if (matchingDoc) {
      const data = matchingDoc.data();
      return {
        id: matchingDoc.id,
        displayName: data.displayName,
        email: data.email,
        photoURL: data.photoURL,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      } as User;
    }
    return null;
  }

  const doc = snapshot.docs[0];
  const data = doc.data();
  return {
    id: doc.id,
    displayName: data.displayName,
    email: data.email,
    photoURL: data.photoURL,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  } as User;
}

export async function getUsersByIds(userIds: string[]): Promise<User[]> {
  if (userIds.length === 0) return [];

  const db = getFirebaseDb();
  // Firestore 'in' query has a limit of 30 items
  const chunks: string[][] = [];
  for (let i = 0; i < userIds.length; i += 30) {
    chunks.push(userIds.slice(i, i + 30));
  }

  const users: User[] = [];
  for (const chunk of chunks) {
    const q = query(
      collection(db, 'users'),
      where(documentId(), 'in', chunk)
    );
    const snapshot = await getDocs(q);
    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      users.push({
        id: doc.id,
        displayName: data.displayName,
        email: data.email,
        photoURL: data.photoURL,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      });
    });
  }

  return users;
}

export function subscribeToUsers(
  userIds: string[],
  callback: (users: User[]) => void
): () => void {
  if (userIds.length === 0) {
    callback([]);
    return () => {};
  }

  const db = getFirebaseDb();
  // For simplicity, only subscribe to first 30 users
  const limitedIds = userIds.slice(0, 30);
  const q = query(
    collection(db, 'users'),
    where(documentId(), 'in', limitedIds)
  );

  return onSnapshot(q, (snapshot) => {
    const users = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        displayName: data.displayName,
        email: data.email,
        photoURL: data.photoURL,
        createdAt: toDate(data.createdAt),
        updatedAt: toDate(data.updatedAt),
      } as User;
    });
    callback(users);
  });
}

// ==================== User Memo ====================

export async function getUserMemo(userId: string): Promise<string> {
  const db = getFirebaseDb();
  const docRef = doc(db, 'userMemos', userId);
  const snapshot = await getDoc(docRef);

  if (!snapshot.exists()) {
    return '';
  }

  return snapshot.data().content || '';
}

export async function updateUserMemo(
  userId: string,
  content: string
): Promise<void> {
  const db = getFirebaseDb();
  const docRef = doc(db, 'userMemos', userId);

  await setDoc(
    docRef,
    {
      userId,
      content,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export function subscribeToUserMemo(
  userId: string,
  callback: (content: string) => void
): () => void {
  const db = getFirebaseDb();
  const docRef = doc(db, 'userMemos', userId);

  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists()) {
      callback(snapshot.data().content || '');
    } else {
      callback('');
    }
  });
}

// ==================== Notifications ====================

export async function createNotification(
  notification: Omit<Notification, 'id' | 'createdAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const notifRef = await addDoc(collection(db, 'notifications'), {
    ...notification,
    createdAt: serverTimestamp(),
  });
  return notifRef.id;
}

export async function getUserNotifications(userId: string): Promise<Notification[]> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
    createdAt: toDate(doc.data().createdAt),
  })) as Notification[];
}

export function subscribeToUserNotifications(
  userId: string,
  callback: (notifications: Notification[]) => void
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc')
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const notifications = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        createdAt: toDate(doc.data().createdAt),
      })) as Notification[];
      callback(notifications);
    },
    (error) => {
      console.error('[Firestore] Notification subscription error:', error);
      // Return empty array on error to stop loading
      callback([]);
    }
  );
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  const db = getFirebaseDb();
  await updateDoc(doc(db, 'notifications', notificationId), {
    isRead: true,
  });
}

export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'notifications'),
    where('userId', '==', userId),
    where('isRead', '==', false)
  );

  const snapshot = await getDocs(q);
  const batch = writeBatch(db);

  snapshot.docs.forEach((doc) => {
    batch.update(doc.ref, { isRead: true });
  });

  await batch.commit();
}

export async function deleteNotification(notificationId: string): Promise<void> {
  const db = getFirebaseDb();
  await deleteDoc(doc(db, 'notifications', notificationId));
}

// ==================== Activity Log ====================

export async function createActivityLog(
  projectId: string,
  data: Omit<ActivityLog, 'id' | 'createdAt'>
): Promise<string> {
  const db = getFirebaseDb();
  const logRef = await addDoc(
    collection(db, 'projects', projectId, 'activityLogs'),
    {
      ...data,
      createdAt: serverTimestamp(),
    }
  );
  return logRef.id;
}

export function subscribeToActivityLogs(
  projectId: string,
  callback: (logs: ActivityLog[]) => void,
  maxItems: number = 50
): () => void {
  const db = getFirebaseDb();
  const q = query(
    collection(db, 'projects', projectId, 'activityLogs'),
    orderBy('createdAt', 'desc'),
    firestoreLimit(maxItems)
  );

  return onSnapshot(q, (snapshot) => {
    const logs = snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        createdAt: toDate(data.createdAt),
      } as ActivityLog;
    });
    callback(logs);
  });
}
