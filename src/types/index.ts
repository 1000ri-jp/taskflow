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
  defaultAssigneeId?: string | null; // Optional default for new work; independent of ownership.
  memberIds: string[];
  urls?: ProjectUrl[]; // Related URLs for the project
  isArchived: boolean;
  order: number; // Legacy default order; personal sidebar order lives on the user document
  createdAt: Date;
  updatedAt: Date;
}

// Project URL type
export interface ProjectUrl {
  id: string;
  title: string;
  url: string;
}

export type MilestoneStatus = 'planned' | 'in_progress' | 'achieved' | 'cancelled';

export interface Milestone {
  kind?: 'date' | 'achievement';
  achievementCondition?: string;
  requiredTaskIds?: string[];
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  dueDate: Date | null;
  order: number;
  achievedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
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
  defaultAssigneeId?: string | null; // List default takes precedence over the project default for new work.
  createdAt: Date;
  updatedAt: Date;
}

// Task types
export interface TaskWorkState {
  status: 'hold' | 'wait';
  reason: string;
  resumeCondition: string;
  reviewAt: string | null;
}

export interface Task {
  aiSuggested?: boolean; // Created from an AI proposal; its normal label remains editable.
  recurrence?: import('@/lib/task/recurrence').TaskRecurrence | null;
  completionCriteria?: string;
  primaryAssigneeId?: string | null;
  workProgress?: 'not_started' | 'started';
  review?: import('@/lib/task/workflow').ReviewCycle;
  reviewRequests?: Record<string, import('@/lib/task/reviews').TaskReviewRequest>;
  reviewRecordId?: string; // In-memory compatibility projection, never a task document.
  workState?: TaskWorkState | null;
  relatedTaskIds?: string[];
  mergedIntoTaskId?: string;
  mergedFromTaskIds?: string[];
  automation?: import('@/lib/task/automationTypes').TaskAutomationSummary;
  completionPolicy?: import('@/lib/task/automationTypes').AllChildrenCompletionPolicy;
  id: string;
  // Shared review requests reuse the task collection and normal assignee/completion fields.
  parentTaskId?: string;
  /** Parent-owned order for visible direct subtasks; Task.order remains board order. */
  subtaskOrderIds?: string[];
  sourceCommentId?: string;
  sourceCommentTaskId?: string; // Original comment location, independent of the current parent.
  taskKind?: 'review_request' | 'decision';
  milestoneId?: string | null;
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
  autoArchiveCompletedAt?: Date | null; // Retained on restore; the same completion is not auto-archived again
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
  dueDate?: string | null;
}

// Comment types
export type CommentPurpose = 'memo' | 'review_request';
export interface Comment {
  id: string;
  purpose?: CommentPurpose;
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
