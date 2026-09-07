// User types
export interface User {
  id: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Project types
export interface Project {
  id: string;
  name: string;
  description: string;
  icon: string;
  iconUrl?: string; // Custom icon image URL (overrides emoji icon)
  headerImageUrl?: string; // Project header/banner image URL
  color: string;
  ownerId: string;
  memberIds: string[];
  urls?: ProjectUrl[]; // Related URLs for the project
  isArchived: boolean;
  order: number; // Display order in sidebar
  createdAt: Date;
  updatedAt: Date;
}

// Project URL type
export interface ProjectUrl {
  id: string;
  title: string;
  url: string;
}

export interface ProjectMember {
  id: string; // Firestore document ID
  userId: string;
  role: 'admin' | 'editor' | 'viewer';
  joinedAt: Date;
}

export type ProjectRole = 'admin' | 'editor' | 'viewer';

// List types
export interface List {
  id: string;
  projectId: string;
  name: string;
  color: string;
  order: number;
  autoCompleteOnEnter: boolean; // Mark tasks as complete when entering this list
  autoUncompleteOnExit: boolean; // Remove completion when tasks leave this list
  autoSetStartDateOnEnter: boolean; // Set task startDate when entering this list (only if not already set)
  createdAt: Date;
  updatedAt: Date;
}

// Task types
export interface Task {
  id: string;
  // Shared review requests reuse the task collection and normal assignee/completion fields.
  parentTaskId?: string;
  sourceCommentId?: string;
  taskKind?: 'review_request';
  projectId: string;
  listId: string;
  title: string;
  description: string;
  order: number;
  assigneeIds: string[];
  labelIds: string[];
  tagIds: string[];
  dependsOnTaskIds: string[]; // Task IDs that must be completed before this task can start
  priority: Priority | null;
  startDate: Date | null;
  dueDate: Date | null;
  durationDays: number | null; // Duration in days (for Gantt chart). If set, dueDate = startDate + durationDays
  isDueDateFixed: boolean; // true=期限固定（duration優先しない）, false=duration優先（期限自動計算）
  isCompleted: boolean;
  completedAt: Date | null; // When the task was completed
  isAbandoned: boolean; // Task was abandoned/cancelled
  isArchived: boolean; // Soft delete - archived tasks are hidden but not deleted
  archivedAt: Date | null; // When the task was archived
  archivedBy: string | null; // Who archived the task
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type Priority = 'high' | 'medium' | 'low';

// Tag types (project-level status tags)
export interface Tag {
  id: string;
  projectId: string;
  name: string;
  color: string;
  order: number;
  createdAt: Date;
}

// Checklist types
export interface Checklist {
  id: string;
  taskId: string;
  title: string;
  order: number;
  items: ChecklistItem[];
  createdAt: Date;
}

export interface ChecklistItem {
  id: string;
  text: string;
  isChecked: boolean;
  order: number;
}

// Comment types
export interface Comment {
  id: string;
  reviewTaskId?: string;
  taskId: string;
  content: string;
  authorId: string;
  authorLabel?: string;
  authorIcon?: string | null;
  mentions: string[];
  attachments?: CommentAttachment[];
  createdAt: Date;
  updatedAt: Date;
}

// Comment attachment type
export interface CommentAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
}

// Attachment types
export interface Attachment {
  id: string;
  taskId: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedBy: string;
  uploadedAt: Date;
}

// Label types
export interface Label {
  id: string;
  projectId: string;
  name: string;
  color: string;
  createdAt: Date;
}

// Notification types
export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  projectId: string;
  projectName?: string;
  taskId: string | null;
  taskName?: string;
  senderId?: string;
  senderName?: string;
  isRead: boolean;
  createdAt: Date;
  data: Record<string, unknown>;
}

export type NotificationType =
  | 'review_requested'
  | 'task_assigned'
  | 'task_updated'
  | 'comment_added'
  | 'mentioned'
  | 'due_reminder'
  | 'task_bell'; // Bell notification from task

// User memo type
export interface UserMemo {
  id: string;
  userId: string;
  content: string;
  updatedAt: Date;
}

// Activity log types
export interface ActivityLog {
  id: string;
  projectId: string;
  targetType: ActivityTargetType;
  targetId: string;
  targetName: string;
  action: ActivityAction;
  userId: string;
  userName: string;
  changes?: ActivityChange[];
  createdAt: Date;
}

export interface ActivityChange {
  field: string;
  oldValue?: string;
  newValue?: string;
}

export type ActivityTargetType = 'task' | 'list' | 'project' | 'member';

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'complete'
  | 'reopen'
  | 'assign'
  | 'unassign'
  | 'add_member'
  | 'remove_member';

// Label color presets
export const LABEL_COLORS = [
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'yellow', value: '#eab308' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'purple', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
  { name: 'gray', value: '#6b7280' },
] as const;

// List color presets
export const LIST_COLORS = [
  { name: 'slate', value: '#64748b' },
  { name: 'red', value: '#ef4444' },
  { name: 'orange', value: '#f97316' },
  { name: 'amber', value: '#f59e0b' },
  { name: 'green', value: '#22c55e' },
  { name: 'teal', value: '#14b8a6' },
  { name: 'blue', value: '#3b82f6' },
  { name: 'indigo', value: '#6366f1' },
  { name: 'purple', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
] as const;

// Tag color presets
export const TAG_COLORS = [
  { name: 'blue', value: '#3b82f6' },
  { name: 'orange', value: '#f97316' },
  { name: 'green', value: '#22c55e' },
  { name: 'red', value: '#ef4444' },
  { name: 'purple', value: '#8b5cf6' },
  { name: 'pink', value: '#ec4899' },
  { name: 'teal', value: '#14b8a6' },
  { name: 'gray', value: '#6b7280' },
] as const;

// Default tags for new projects
export const DEFAULT_TAGS = [
  { name: '進行中', color: '#3b82f6' },
  { name: '指示待ち', color: '#f97316' },
  { name: '完了', color: '#22c55e' },
  { name: '確認中', color: '#ef4444' },
] as const;
