'use client';
import { DetailFrame, DetailBody, detailHeader, detailContent, detailDialog } from '@/components/ui/screen-layouts';
import { Prose } from '@/components/ui/typography';

import Image from 'next/image';
import { useState, useEffect, useRef } from 'react';
import { format, startOfDay } from 'date-fns';
import { ja } from 'date-fns/locale';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ControlHint } from '@/components/ui/control-hint';
import { TaskListPicker, type MoveTaskToList } from '@/components/board/TaskListPicker';
import { TaskProjectPicker } from './TaskProjectPicker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { SortableChecklistItems } from './SortableChecklistItems';
import type { ChecklistMemberState } from './ChecklistItemAssignees';
import { TaskArchiveButton } from './TaskArchiveButton';
import { CommentComposer } from './CommentComposer';
import { CommentReactions } from './CommentReactions';
import { COMMENT_PURPOSE_LABELS } from '@/lib/task/commentSubmission';
import { parentReviews } from '@/lib/task/reviews';
import { TaskRelations } from './TaskRelations';
import { reorderTaskSubtasks } from '@/lib/firebase/subtask-order';
import { TaskSubtaskCreator, type AddSubtask } from './TaskSubtaskCreator';
import { TaskWorkflow } from './TaskWorkflow';
import { TaskStatusControl } from './TaskStatusControl';
import { TaskSituation } from './TaskSituation';
import { TaskAutomationPanel } from './TaskAutomationPanel';
import { TaskRecurrencePanel } from './TaskRecurrencePanel';
import { RECURRENCE_UNITS } from '@/lib/task/recurrence';
import { taskDateError, hasTaskDateChange } from '@/lib/task/dateValidation';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
import { TaskHistoryTimeline } from './TaskHistoryTimeline';
import { TaskParentPicker } from './TaskParentPicker';
import { ChecklistTitle } from './ChecklistTitle';
import type { ChangeTaskParent } from '@/lib/task/parentTask';
import { useMeetingMembers } from '@/hooks/useMeetingMembers';
import { Progress } from '@/components/ui/progress';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Calendar as CalendarIcon,
  Tag as TagIcon,
  Bookmark,
  ListChecks,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Flag,
  Plus,
  Check,
  Paperclip,
  CheckCircle2,
  Pencil,
  Link2,
  AlertCircle,
  Lock,
  Copy,
  Clock,
  Maximize2,
  Minimize2,
  Repeat2,
} from 'lucide-react';
import { cn, linkifyText } from '@/lib/utils';
import {
  calculateEffectiveStartDate,
  hasCircularDependency,
  getDependencyTasks,
  isTaskBlocked,
  getBottleneckTask,
  recalculateDates,
  getEffectiveDates,
  isTaskOverdue,
} from '@/lib/utils/task';
import { useTaskDetails } from '@/hooks/useTaskDetails';
import { useAuthStore } from '@/stores/authStore';
import { getProject, getProjectTags, createTag, getUsersByIds } from '@/lib/firebase/firestore';
import { AssigneeSelector } from './AssigneeSelector';
import { AttachmentPreview, AttachmentPreviewCompact } from './AttachmentPreview';
import type { Task, Label as LabelType, Tag as TagType, List, Priority, Checklist } from '@/types';
import { TAG_COLORS } from '@/types';
import { ReferenceMigrationDialog } from './ReferenceMigrationDialog';

interface TaskDetailModalProps {
  task: Task | null;
  projectId: string;
  lists: List[];
  labels: LabelType[];
  allTasks: Task[]; // All tasks in the project for dependency selection
  isOpen: boolean;
  onClose: () => void;
  onUpdate: (data: Partial<Task>) => void | Promise<void>;
  onDelete: () => void;
  onDuplicate?: () => void;
  onMoveTask?: MoveTaskToList;
  onChangeParent?: ChangeTaskParent;
  onAddSubtask?: AddSubtask;
  onDeleteSubtask?: (taskId: string) => Promise<void>;
  highlightCommentId?: string | null;
  highlightSubtaskId?: string | null;
  openHistory?: boolean;
}

export function TaskDetailModal({
  task,
  projectId,
  lists,
  labels,
  allTasks,
  isOpen,
  onClose,
  onUpdate: persistUpdate,
  onDelete,
  onDuplicate,
  onMoveTask,
  onChangeParent,
  onAddSubtask,
  onDeleteSubtask,
  highlightCommentId,
  highlightSubtaskId,
  openHistory = false,
}: TaskDetailModalProps) {
  const { user } = useAuthStore();
  const reviews = task ? parentReviews(task, allTasks) : [];
  useEffect(() => { if (isOpen) window.dispatchEvent(new Event('taskflow-task-opened')); }, [isOpen, task?.id]);
  useEffect(() => {
    if (!isOpen || !highlightSubtaskId) return;
    const frame = requestAnimationFrame(() => document.getElementById(`task-subtask-${highlightSubtaskId}`)?.scrollIntoView({block:'center'}));
    return () => cancelAnimationFrame(frame);
  }, [isOpen, highlightSubtaskId, task?.id]);
  const mockMode = isE2EMockAuthEnabled();
  const {
    checklists,
    comments,
    commentStatus,
    detailsError,
    addChecklist,
    editChecklist,
    removeChecklist,
    addChecklistItem,
    toggleChecklistItem,
    removeChecklistItem,
    editChecklistItemText,
    moveChecklistItem,
    setChecklistItemDeadline,
    removeComment,
    editComment,
    getAllCommentAttachments,
  } = useTaskDetails(projectId, task?.id || null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expandedWidth, setExpandedWidth] = useState(false);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [dueDate, setDueDate] = useState<Date | undefined>();
  const [deadlinePopup, setDeadlinePopup] = useState({ taskId: '', open: false, recurrence: false });
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [durationDays, setDurationDays] = useState<number | null>(null);
  const [scheduleError, setScheduleError] = useState<{ taskId: string; message: string } | null>(null);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedAt, setCompletedAt] = useState<Date | undefined>();
  const [expandedChecklists, setExpandedChecklists] = useState<Set<string>>(new Set());
  const [projectMemberIds, setProjectMemberIds] = useState<string[]>([]);
  const [projectTags, setProjectTags] = useState<TagType[]>([]);
  const [commentAuthors, setCommentAuthors] = useState<Record<string, { displayName: string; photoURL?: string }>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState<string>(TAG_COLORS[0].value);
  const [memberProject, setMemberProject] = useState({ id: '', name: '', error: false });
  const [memberAttempt, setMemberAttempt] = useState(0);
  const checklistMembers = useMeetingMembers([{ memberIds: projectMemberIds }], isOpen && !mockMode && memberProject.id === projectId && !memberProject.error);
  const localMembers: ChecklistMemberState & { refresh: () => void } = mockMode ? { users: [{ id: 'e2e-mock-user', displayName: '本人' }, { id: 'demo-colleague', displayName: '同僚' }], isLoading: false, hasError: false, refresh: () => {} } : { ...checklistMembers, isLoading: memberProject.id !== projectId || checklistMembers.isLoading, hasError: memberProject.error || checklistMembers.hasError,
    refresh: () => { setMemberProject({ id: '', name: '', error: false }); setMemberAttempt(value => value + 1); checklistMembers.refresh(); } };
  useEffect(() => {
    if (!isOpen || !highlightCommentId || !comments.some(comment => comment.id === highlightCommentId)) return;
    const frame = requestAnimationFrame(() => document.getElementById(`task-comment-${highlightCommentId}`)?.scrollIntoView({ block: 'center' }));
    return () => cancelAnimationFrame(frame);
  }, [isOpen, highlightCommentId, comments]);
  // Fetch project members and name
  useEffect(() => {
    let active = true;
    if (projectId) {
      const readProject = mockMode ? Promise.all([import('@/lib/task/organizationMock'), import('@/lib/task/meetingMultiExample')]).then(([{ readOrganizationMock }, { MEETING_MOCK_PROJECTS }]) => ({ name: MEETING_MOCK_PROJECTS.find(project => project.id === projectId)?.name ?? '', memberIds: readOrganizationMock(projectId).data.memberIds, description: '隔離データで仕事の流れを確認する' })) : getProject(projectId);
      readProject.then((project) => {
        if (!active) return;
        if (project) {
          setProjectMemberIds(project.memberIds);
        }
        setMemberProject({ id: projectId, name: project?.name ?? '', error: !project });
      }).catch(() => {
        if (active) setMemberProject({ id: projectId, name: '', error: true });
      });
    }
    return () => { active = false; };
  }, [projectId, memberAttempt, mockMode]);

  // Fetch project tags
  useEffect(() => {
    if (projectId) {
      if (mockMode) { setProjectTags([]); return; }
      getProjectTags(projectId).then(setProjectTags).catch(() => setProjectTags([]));
    }
  }, [projectId, mockMode]);

  // Fetch comment authors
  useEffect(() => {
    const authorIds = [...new Set(comments.map(c => c.authorId))];
    if (authorIds.length > 0) {
      const readAuthors = mockMode ? Promise.resolve(authorIds.map(id => ({ id, displayName: id === 'e2e-mock-user' ? '本人' : '同僚', photoURL: null }))) : getUsersByIds(authorIds);
      readAuthors.then((users) => {
        const authorsMap: Record<string, { displayName: string; photoURL?: string }> = {};
        users.forEach((u) => {
          authorsMap[u.id] = { displayName: u.displayName, photoURL: u.photoURL || undefined };
        });
        setCommentAuthors(authorsMap);
      });
    }
  }, [comments, mockMode]);

  // Initialize form when task changes
  useEffect(() => {
    if (task) {
      Promise.resolve().then(() => {
        setScheduleError(null);
        setTitle(task.title);
        setDescription(task.description || '');
        setPriority(task.priority);
        setDueDate(task.dueDate || undefined);
        setStartDate(task.startDate || undefined);
        setDurationDays(task.durationDays);
        setSelectedLabelIds(task.labelIds);
        setIsCompleted(task.isCompleted);
        setCompletedAt(task.completedAt || undefined);
      });
    }
  }, [task]);

  // Expand all checklists by default
  useEffect(() => {
    if (checklists.length > 0) {
      Promise.resolve().then(() => {
        setExpandedChecklists(new Set(checklists.map(c => c.id)));
      });
    }
  }, [checklists]);

  const onUpdate = async (changes: Partial<Task>) => {
    const scheduleChange = hasTaskDateChange(changes);
    if (!scheduleChange) { await persistUpdate(changes); return; }
    if (!task) return;
    const restore = () => { setStartDate(task.startDate || undefined); setDueDate(task.dueDate || undefined); setDurationDays(task.durationDays); };
    const invalid = taskDateError({ ...task, ...changes });
    if (invalid) { restore(); setScheduleError({ taskId: task.id, message: invalid }); return; }
    setScheduleBusy(true); setScheduleError(null);
    try { await persistUpdate(changes); }
    catch (error) { restore(); setScheduleError({ taskId: task.id, message: error instanceof Error ? error.message : '日程を保存できませんでした。もう一度設定してください。' }); }
    finally { setScheduleBusy(false); }
  };

  const handleSubtaskReorder = async (expectedIds: string[], orderedIds: string[]) => {
    if (!task || !user) throw new Error('ログイン状態を確認してください。');
    if (mockMode) {
      const { actTaskDetailsMock } = await import('@/lib/task/detailMock');
      await actTaskDetailsMock(projectId, task.id, { kind: 'moveSubtasks', expectedIds, orderedIds });
      return;
    }
    await reorderTaskSubtasks(projectId, task.id, expectedIds, orderedIds);
  };

  const visibleScheduleError = scheduleError && scheduleError.taskId === task?.id ? scheduleError.message : taskDateError({ startDate, dueDate });

  const handleSave = () => {
    // Merely opening local assignee controls must not write unchanged shared data.
    const changes: Partial<Task> = {};
    if (task && title !== task.title) changes.title = title;
    if (task && description !== (task.description || '')) changes.description = description;
    if (Object.keys(changes).length) onUpdate(changes);
  };

  // Toggle completion with automatic completedAt handling
  const handleAssigneeUpdate = (newAssigneeIds: string[]) => {
    onUpdate({ assigneeIds: newAssigneeIds });
  };

  const handleLabelToggle = (labelId: string) => {
    const newLabelIds = selectedLabelIds.includes(labelId)
      ? selectedLabelIds.filter((id) => id !== labelId)
      : [...selectedLabelIds, labelId];
    setSelectedLabelIds(newLabelIds);
    onUpdate({ labelIds: newLabelIds });
  };

  const handleTagToggle = (tagId: string) => {
    const currentTagIds = task?.tagIds || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId];
    onUpdate({ tagIds: newTagIds });
  };

  const handleCreateTag = async () => {
    if (mockMode) { setIsAddingTag(false); return; }
    if (newTagName.trim() && projectId) {
      const tagId = await createTag(projectId, {
        name: newTagName.trim(),
        color: newTagColor,
        order: projectTags.length,
      });
      // Refresh tags
      const updatedTags = await getProjectTags(projectId);
      setProjectTags(updatedTags);
      // Add the new tag to the task
      const currentTagIds = task?.tagIds || [];
      onUpdate({ tagIds: [...currentTagIds, tagId] });
      // Reset form
      setNewTagName('');
      setNewTagColor(TAG_COLORS[0].value);
      setIsAddingTag(false);
    }
  };

  // Get all comment attachments for Jooto-style display at task top
  const commentAttachments = getAllCommentAttachments();

  const toggleChecklistExpanded = (checklistId: string) => {
    setExpandedChecklists(prev => {
      const next = new Set(prev);
      if (next.has(checklistId)) {
        next.delete(checklistId);
      } else {
        next.add(checklistId);
      }
      return next;
    });
  };

  const getChecklistProgress = (checklist: Checklist) => {
    if (checklist.items.length === 0) return 0;
    const completed = checklist.items.filter(item => item.isChecked).length;
    return Math.round((completed / checklist.items.length) * 100);
  };

  const currentList = lists.find((l) => l.id === task?.listId);

  if (!task) return null;
  if (task.isArchived) return <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>{task.title}</DialogTitle><DialogDescription>アーカイブしたタスク</DialogDescription></DialogHeader>
      <p className="text-xs text-muted-foreground">{lists.find(list => list.id === task.listId)?.name ?? '分類不明'}</p>
      <Prose>{task.description || '説明はありません'}</Prose>
      <TaskStatusControl key={`status:${user?.id}:${task.id}`} task={task} tasks={allTasks} userId={user?.id ?? ''} showSuccess={false} />
    </DialogContent>
  </Dialog>;
  const isOverdue = !task.isAbandoned && !task.isArchived && isTaskOverdue(
    { ...task, dueDate: dueDate || null, isCompleted }, startOfDay(new Date())
  );
  const migrationHasBlockers = allTasks.some(candidate => candidate.parentTaskId === task.id && !candidate.isArchived && !candidate.isCompleted)
    || checklists.some(checklist => checklist.items.some(item => !item.isChecked))
    || task.dependsOnTaskIds.length > 0
    || reviews.some(review => !review.isCompleted)
    || !!task.automation
    || !!task.completionPolicy;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent onEscapeKeyDown={event => {
        if (event.isComposing || (event.target instanceof HTMLElement && event.target.matches('[data-checklist-title-editor], [data-checklist-item-editor]'))) event.preventDefault();
      }} className={cn(detailDialog, expandedWidth && 'sm:max-w-[min(1200px,calc(100vw-2rem))]')}>
        <DetailFrame>
          {/* Header */}
          <DialogHeader className={cn(detailHeader, 'pt-5 pb-1')}>
            <DialogDescription className="sr-only">
              タスクの内容、担当者、日程、チェックリスト、コメントを確認・編集します。
            </DialogDescription>
            <div className="flex items-start gap-3 pr-7">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                <DialogTitle className="relative min-w-0 max-w-full">
                  <span aria-hidden="true" className="invisible block min-w-12 overflow-hidden whitespace-pre text-base font-semibold leading-9">{title || 'タスク名'}</span>
                  <Input aria-label="タスク名" value={title} onChange={e => setTitle(e.target.value)} onBlur={handleSave}
                    className={cn('absolute inset-0 h-9 min-w-0 border-none p-0 text-base font-semibold shadow-none focus-visible:ring-0 md:text-base', isCompleted && 'line-through text-muted-foreground')} />
                </DialogTitle>
                <div role="group" aria-label="リストと親タスク" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {onMoveTask && <TaskProjectPicker key={`project:${user?.id}:${projectId}:${task.id}`} projectId={projectId} taskId={task.id} projectName={memberProject.id === projectId && !memberProject.error ? memberProject.name : undefined} />}
                  {currentList && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: currentList.color }} />}
                  {onMoveTask ? <TaskListPicker key={`list:${task.id}`} task={task} lists={lists} onMove={onMoveTask} showName className="min-w-0 shrink" /> : <span className="max-w-44 truncate" title="リスト">{currentList?.name ?? '分類不明'}</span>}
                  {onChangeParent && <TaskParentPicker key={`parent:${task.id}`} compact task={task} tasks={allTasks} lists={lists} onChange={onChangeParent} />}
                  <TaskAutomationPanel compact key={`automation:${user?.id}/${task.projectId}/${task.id}`} task={task} tasks={allTasks} users={localMembers.users} />
                </div>
              </div>
              <ControlHint label={expandedWidth ? '幅を戻す' : '幅を広げる'} description="タスク詳細の表示幅を切り替えます。">
                <Button type="button" variant="ghost" size="icon" className="mt-1 h-7 w-7 shrink-0" aria-label={expandedWidth ? 'タスク詳細の幅を戻す' : 'タスク詳細の幅を広げる'} aria-pressed={expandedWidth} onClick={() => setExpandedWidth(value => !value)}>
                  {expandedWidth ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </ControlHint>
            </div>
          </DialogHeader>

          {/* Content */}
          <DetailBody>
            <div className={detailContent}>
              {detailsError && <p role="alert" className="text-xs text-amber-700">{detailsError}</p>}
              <section className="mb-3 space-y-2" aria-label="説明と経緯">
                <label htmlFor={`task-description-${task.id}`} className="text-sm font-semibold">説明</label>
                <Textarea
                  id={`task-description-${task.id}`}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={handleSave}
                  placeholder="内容・目的・完了条件などを記入..."
                  rows={3}
                  className="resize-none break-words bg-white"
                />
                <details key={task.id} open={openHistory || undefined} className="text-sm">
                  <summary className="cursor-pointer py-1 text-xs text-muted-foreground">経緯・変更履歴を見る</summary>
                  <TaskHistoryTimeline key={`history:${user?.id}/${projectId}/${task.id}`} projectId={projectId} taskId={task.id} userId={user?.id}
                    comments={comments} commentStatus={commentStatus} taskUpdatedAt={task.updatedAt?.toISOString()} names={Object.fromEntries(Object.entries(commentAuthors).map(([id, author]) => [id, author.displayName]))} enabled={isOpen} />
                </details>
              </section>
              {task.title === '情報' && user && <div className="flex justify-end"><ReferenceMigrationDialog task={task} projectId={projectId} comments={comments} commentAttachments={commentAttachments.map(({ attachment }) => attachment)} hasBlockers={migrationHasBlockers} onUpdate={onUpdate} userId={user.id} /></div>}
              {/* Comment Attachments (Jooto-style at top) */}
              {commentAttachments.length > 0 && (
                <section className="mb-2" aria-label="添付ファイル">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Paperclip className="h-4 w-4" />
                    添付ファイル ({commentAttachments.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {commentAttachments.map(({ attachment }) => (
                      <AttachmentPreview
                        key={attachment.id}
                        id={attachment.id}
                        name={attachment.name}
                        url={attachment.url}
                        type={attachment.type}
                        size={attachment.size}
                      />
                    ))}
                  </div>
                </section>
              )}


              <TaskSituation task={task} tasks={allTasks} names={Object.fromEntries(localMembers.users.map(member => [member.id, member.displayName]))} />
              {reviews.some(review=>!review.isCompleted) && <div className="flex flex-wrap gap-2 text-xs">{reviews.filter(review=>!review.isCompleted).map(review=><button key={review.id} type="button" className="rounded border px-2 py-1 text-amber-800" onClick={()=>document.getElementById(`task-comment-${review.sourceCommentId}`)?.scrollIntoView({block:'center',behavior:'smooth'})}>確認依頼へ：{review.review?.request.split('\n')[0].slice(0,40)}</button>)}</div>}
              {user && task.taskKind === 'review_request' && <TaskWorkflow key={`workflow:${user.id}:${projectId}:${task.id}`} task={task} tasks={allTasks} userId={user.id} names={Object.fromEntries(localMembers.users.map(member => [member.id, member.displayName]))} />}

              {/* Metadata Row */}
              <div className="space-y-1.5" aria-label="タスクの設定">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <div role="group" aria-label="日程" className="flex flex-wrap items-center gap-x-6 gap-y-1 py-1">
                {/* Start Date */}
                <div className="flex min-w-0 items-center gap-2 py-1 text-sm">
                  <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {task?.dependsOnTaskIds && task.dependsOnTaskIds.length > 0 ? (
                    // 依存タスクあり: ロック表示
                    <div className="flex flex-1 items-center gap-2">
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <span>
                          開始: {(() => {
                            const date = calculateEffectiveStartDate(task, allTasks);
                            return date ? format(date, 'M/d', { locale: ja }) : '未定';
                          })()}
                        </span>
                        <Lock className="h-3 w-3" />
                      </div>
                      {/* ボトルネックタスク表示 */}
                      {(() => {
                        const bottleneck = getBottleneckTask(task, allTasks);
                        if (bottleneck) {
                          return (
                            <span className="ml-auto max-w-[150px] truncate text-xs text-amber-600">
                              ← {bottleneck.title}
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    // 依存タスクなし: 編集可能
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground">
                          {startDate ? (
                            <span>開始: {format(startDate, 'M/d', { locale: ja })}</span>
                          ) : (
                            '開始日を設定'
                          )}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-4" align="start">
                        <Calendar
                          mode="single"
                          selected={startDate}
                          defaultMonth={startDate ?? dueDate}
                          disabled={scheduleBusy ? true : dueDate ? { after: dueDate } : undefined}
                          onSelect={(date) => {
                            setStartDate(date);
                            onUpdate({ startDate: date || null });
                          }}
                        />
                        {dueDate && <p className="px-3 pb-1 text-xs text-muted-foreground">開始日は期限（{format(dueDate, 'M/d')}）以前に設定してください。</p>}
                      </PopoverContent>
                    </Popover>
                  )}
                </div>

                {/* Due Date */}
                <div className={cn('flex min-w-0 items-center gap-2 py-1 text-sm', isOverdue && 'rounded-md bg-red-50 px-2')}>
                  <CalendarIcon className={cn('h-4 w-4 shrink-0', isOverdue ? 'text-red-700' : 'text-muted-foreground')} />
                  <Popover modal open={deadlinePopup.taskId === task.id && deadlinePopup.open} onOpenChange={open => setDeadlinePopup({ taskId: task.id, open, recurrence: false })}>
                    <PopoverTrigger asChild>
                      <button
                        aria-label={`${dueDate ? `期限: ${format(dueDate, 'M/d', { locale: ja })}${isOverdue ? '（期限超過）' : ''}` : '期限を設定'}${task.recurrence ? `（繰り返し：${task.recurrence.interval}${RECURRENCE_UNITS[task.recurrence.unit]}ごと）` : ''}`}
                        title={isOverdue ? '期限超過' : undefined}
                        className={cn('inline-flex flex-wrap items-center gap-1.5 text-left', isOverdue ? 'font-semibold text-red-700 hover:text-red-800' : 'text-muted-foreground hover:text-foreground')}
                      >
                        {dueDate ? (
                          <span>期限: {format(dueDate, 'M/d', { locale: ja })}</span>
                        ) : (
                          '期限を設定'
                        )}
                        {isOverdue && <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                      </button>
                    </PopoverTrigger>
                    {task.recurrence && task.taskKind !== 'review_request' && !task.isAbandoned && <ControlHint label="繰り返しを設定" description="期限の設定を開き、繰り返しの間隔を設定します。">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="繰り返しを設定" onClick={() => setDeadlinePopup({ taskId: task.id, open: true, recurrence: true })}>
                        <span role="img" aria-label={`繰り返し：${task.recurrence.interval}${RECURRENCE_UNITS[task.recurrence.unit]}ごと`} title={`繰り返し：${task.recurrence.interval}${RECURRENCE_UNITS[task.recurrence.unit]}ごと`}><Repeat2 className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" /></span>
                      </Button>
                    </ControlHint>}
                    <PopoverContent className="w-[min(360px,calc(100vw-2rem))] max-h-[min(75dvh,var(--radix-popover-content-available-height))] overflow-y-auto p-3" align="start" collisionPadding={8} aria-label="期限の設定">
                      <Calendar
                        className="mx-auto"
                        mode="single"
                        selected={dueDate}
                        defaultMonth={dueDate ?? startDate}
                        disabled={scheduleBusy ? true : startDate ? { before: startDate } : undefined}
                        onSelect={(date) => {
                          if (task && date) {
                            // Use recalculateDates to properly update duration
                            const result = recalculateDates(task, { dueDate: date });
                            setDueDate(date);
                            setDurationDays(result.durationDays);
                            onUpdate({
                              dueDate: date,
                              durationDays: result.durationDays,
                              isDueDateFixed: true,
                            });
                          } else {
                            setDueDate(date || undefined);
                            onUpdate({ dueDate: date || null });
                          }
                        }}
                      />
                      {startDate && <p className="px-3 pb-2 text-xs text-muted-foreground">期限は開始日（{format(startDate, 'M/d')}）以降に設定してください。</p>}
                      {visibleScheduleError && <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{visibleScheduleError}</p>}
                      <TaskRecurrencePanel key={`recurrence:${user?.id}/${task.projectId}/${task.id}`} task={task} lists={lists} defaultOpen={deadlinePopup.recurrence} />
                    </PopoverContent>
                  </Popover>
                </div>

                {/* Duration Days */}
                <div className="flex min-w-0 items-center gap-2 py-1 text-sm">
                  <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">必要日数:</span>
                    <Input
                      type="number"
                      min={1}
                      value={durationDays ?? ''}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : null;
                        setDurationDays(value);
                      }}
                      onBlur={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : null;
                        if (task && value && value > 0) {
                          // Use recalculateDates to properly update dueDate
                          const result = recalculateDates(task, { durationDays: value });
                          setDueDate(result.dueDate || undefined);
                          onUpdate({
                            durationDays: value,
                            dueDate: result.dueDate,
                            isDueDateFixed: false,
                          });
                        } else if (value === null) {
                          onUpdate({ durationDays: null });
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      placeholder="日数"
                      className="h-7 w-20"
                    />
                    <span className="text-muted-foreground">日</span>
                    {task?.isDueDateFixed && (
                      <Badge variant="outline" className="text-[10px] h-5">
                        期限固定
                      </Badge>
                    )}
                  </div>
                </div>

                </div>
                <div role="group" aria-label="状態" className="flex flex-wrap items-center gap-x-6 gap-y-1">
                {/* Completion Status */}
                <div className="flex min-w-0 items-center gap-2 py-1 text-sm">
                  <TaskStatusControl key={`status:${user?.id}:${task.id}`} task={task} tasks={allTasks} userId={user?.id ?? ''} showSuccess={false} />
                  <div className="flex flex-1 items-center gap-2">
                    {isCompleted && task.taskKind !== 'review_request' && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button className="flex items-center gap-1 rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                            <CalendarIcon className="h-3 w-3" />
                            {completedAt ? format(completedAt, 'M/d', { locale: ja }) : format(new Date(), 'M/d', { locale: ja })}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-4" align="start">
                          <div className="space-y-2">
                            <p className="text-sm font-medium">完了日</p>
                            <Calendar
                              mode="single"
                              selected={completedAt || new Date()}
                              onSelect={(date) => {
                                if (date) {
                                  setCompletedAt(date);
                                  onUpdate({ completedAt: date });
                                }
                              }}
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>


                </div>
                </div>
                {visibleScheduleError && !(deadlinePopup.taskId === task.id && deadlinePopup.open) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{visibleScheduleError}</p>}
                {/* Deadline Overdue Warning */}
                {task && (() => {
                  const effectiveDates = getEffectiveDates(task, allTasks);
                  if (effectiveDates.isDeadlineOverdue) {
                    return (
                      <div className="flex items-center gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                        <AlertCircle className="h-4 w-4" />
                        <span>依存タスクの遅延により、開始日が期限を超過しています</span>
                      </div>
                    );
                  }
                  return null;
                })()}
                <div role="group" aria-label="担当者・依存タスク・優先度・ラベル・タグ" className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                  <AssigneeSelector compact membersOverride={mockMode ? localMembers.users : undefined}
                    assigneeIds={task.assigneeIds}
                    projectMemberIds={projectMemberIds}
                    onUpdate={handleAssigneeUpdate}
                  />

                  <Popover>
                    <ControlHint label={`依存タスク（${task.dependsOnTaskIds.length}件）`} description={task.dependsOnTaskIds.length ? task.dependsOnTaskIds.map(id => allTasks.find(item => item.id === id)?.title ?? '名前を確認できないタスク').join('、') : 'このタスクの前に完了が必要なタスクを設定します。'}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label={`依存タスク（${task.dependsOnTaskIds.length}件）`} className={cn('h-8 w-8 shrink-0 text-muted-foreground', task.dependsOnTaskIds.length > 0 && 'bg-blue-50 text-blue-700')}>
                          <Link2 aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </ControlHint>
                    <PopoverContent className="max-h-[min(32rem,calc(100dvh-4rem))] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-y-auto" align="start" aria-label="依存タスクを選択">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">依存タスク（このタスクの前に完了が必要）</p>
                        <ScrollArea className="max-h-60">
                          <div className="space-y-1">
                            {allTasks
                              .filter((t) => t.id !== task.id && t.projectId === task.projectId && (task.dependsOnTaskIds.includes(t.id) || !t.isArchived && !t.isAbandoned && t.taskKind !== 'review_request'))
                              .sort((a, b) => {
                                // Sort by list order, then by order within list
                                const listA = lists.find((l) => l.id === a.listId);
                                const listB = lists.find((l) => l.id === b.listId);
                                const listOrderA = listA?.order ?? 0;
                                const listOrderB = listB?.order ?? 0;
                                if (listOrderA !== listOrderB) return listOrderA - listOrderB;
                                return a.order - b.order;
                              })
                              .map((t) => {
                                const isSelected = task?.dependsOnTaskIds?.includes(t.id);
                                const wouldCreateCircular = !isSelected && task && hasCircularDependency(task.id, t.id, allTasks);
                                const taskList = lists.find((l) => l.id === t.listId);

                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => {
                                      if (wouldCreateCircular) return;
                                      const currentDeps = task?.dependsOnTaskIds || [];
                                      const newDeps = isSelected
                                        ? currentDeps.filter((id) => id !== t.id)
                                        : [...currentDeps, t.id];

                                      // Calculate new effective start date based on dependencies
                                      const tempTask = { ...task!, dependsOnTaskIds: newDeps };
                                      const effectiveStartDate = calculateEffectiveStartDate(tempTask, allTasks);

                                      // Update both dependencies and start date, recalculating dueDate
                                      const updateData: Partial<Task> = { dependsOnTaskIds: newDeps };
                                      if (effectiveStartDate) {
                                        const result = recalculateDates(task!, { startDate: effectiveStartDate });
                                        updateData.startDate = effectiveStartDate;
                                        updateData.dueDate = result.dueDate;
                                        updateData.durationDays = result.durationDays;
                                        updateData.isDueDateFixed = result.isDueDateFixed;
                                        setStartDate(effectiveStartDate);
                                        setDueDate(result.dueDate || undefined);
                                        setDurationDays(result.durationDays);
                                      } else if (newDeps.length === 0) {
                                        // If removing all dependencies, keep the current startDate (don't reset it)
                                      }
                                      onUpdate(updateData);
                                    }}
                                    disabled={wouldCreateCircular}
                                    className={cn(
                                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                                      isSelected && 'bg-muted',
                                      wouldCreateCircular
                                        ? 'cursor-not-allowed opacity-50'
                                        : 'hover:bg-muted'
                                    )}
                                  >
                                    <div
                                      className="h-2 w-2 flex-shrink-0 rounded-full"
                                      style={{ backgroundColor: taskList?.color || '#6b7280' }}
                                    />
                                    <span className={cn(
                                      'flex-1 truncate text-left',
                                      t.isCompleted && 'line-through text-muted-foreground'
                                    )}>
                                      {t.title}{t.isArchived ? '（アーカイブ済み）' : t.isAbandoned ? '（取りやめ）' : ''}
                                    </span>
                                    {t.isCompleted ? (
                                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                                    ) : t.dueDate ? (
                                      <span className="flex-shrink-0 text-xs text-muted-foreground">
                                        〜{format(t.dueDate, 'M/d', { locale: ja })}
                                      </span>
                                    ) : null}
                                    {isSelected && (
                                      <Check className="h-4 w-4 flex-shrink-0 text-primary" />
                                    )}
                                    {wouldCreateCircular && (
                                      <AlertCircle className="h-4 w-4 flex-shrink-0 text-destructive" />
                                    )}
                                  </button>
                                );
                              })}
                          </div>
                        </ScrollArea>
                        {allTasks.filter((t) => t.id !== task?.id).length === 0 && (
                          <p className="text-xs text-muted-foreground">他にタスクがありません</p>
                        )}
                      </div>
                      {/* Selected dependencies display */}
                      {task?.dependsOnTaskIds && task.dependsOnTaskIds.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {getDependencyTasks(task, allTasks).map((depTask) => {
                            const taskList = lists.find((l) => l.id === depTask.listId);
                            return (
                              <Badge
                                key={depTask.id}
                                variant="outline"
                                className={cn(
                                  'flex items-center gap-1',
                                  depTask.isCompleted && 'bg-green-50 border-green-200'
                                )}
                              >
                                <div
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: taskList?.color || '#6b7280' }}
                                />
                                <span className={cn(
                                  'max-w-[100px] truncate',
                                  depTask.isCompleted && 'line-through'
                                )}>
                                  {depTask.title}
                                </span>
                                {depTask.isCompleted ? (
                                  <CheckCircle2 className="h-3 w-3 text-green-600" />
                                ) : depTask.dueDate ? (
                                  <span className="text-xs text-muted-foreground">
                                    〜{format(depTask.dueDate, 'M/d', { locale: ja })}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label={`${depTask.title}の依存を解除`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newDeps = task.dependsOnTaskIds.filter((id) => id !== depTask.id);

                                    // Calculate new effective start date based on remaining dependencies
                                    const tempTask = { ...task, dependsOnTaskIds: newDeps };
                                    const effectiveStartDate = calculateEffectiveStartDate(tempTask, allTasks);

                                    // Update both dependencies and start date, recalculating dueDate
                                    const updateData: Partial<Task> = { dependsOnTaskIds: newDeps };
                                    if (effectiveStartDate) {
                                      const result = recalculateDates(task, { startDate: effectiveStartDate });
                                      updateData.startDate = effectiveStartDate;
                                      updateData.dueDate = result.dueDate;
                                      updateData.durationDays = result.durationDays;
                                      updateData.isDueDateFixed = result.isDueDateFixed;
                                      setStartDate(effectiveStartDate);
                                      setDueDate(result.dueDate || undefined);
                                      setDurationDays(result.durationDays);
                                    }
                                    onUpdate(updateData);
                                  }}
                                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            );
                          })}
                        </div>
                      )}

                      {/* Effective start date display */}
                      {task && (() => {
                        const effectiveDate = calculateEffectiveStartDate(task, allTasks);
                        const blocked = isTaskBlocked(task, allTasks);
                        if (effectiveDate) {
                          return (
                            <p className={cn(
                              'text-xs',
                              blocked ? 'text-amber-600' : 'text-green-600'
                            )}>
                              {blocked ? (
                                <>開始可能日: {format(effectiveDate, 'M/d', { locale: ja })}（依存タスク未完了）</>
                              ) : (
                                <>開始可能日: {format(effectiveDate, 'M/d', { locale: ja })}（依存タスク完了済み）</>
                              )}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </PopoverContent>
                  </Popover>
                  <Select
                    value={priority || 'none'}
                    onValueChange={(value) => {
                      const newPriority = value === 'none' ? null : (value as Priority);
                      setPriority(newPriority);
                      onUpdate({ priority: newPriority });
                    }}
                  >
                    <ControlHint label={`優先度: ${priority === 'high' ? '高' : priority === 'medium' ? '中' : priority === 'low' ? '低' : 'なし'}`}>
                      <SelectTrigger size="sm" aria-label={`優先度: ${priority === 'high' ? '高' : priority === 'medium' ? '中' : priority === 'low' ? '低' : 'なし'}`}
                        className="h-8 w-8 shrink-0 justify-center gap-0 border-none p-0 shadow-none hover:bg-muted [&>svg:last-child]:hidden">
                        <Flag aria-hidden="true" className={cn('h-4 w-4', priority === 'high' ? 'text-red-600' : priority === 'medium' ? 'text-yellow-600' : priority === 'low' ? 'text-gray-600' : 'text-muted-foreground')} />
                      </SelectTrigger>
                    </ControlHint>
                    <SelectContent position="popper" align="start" sideOffset={4}>
                      <SelectItem value="none">優先度: なし</SelectItem>
                      <SelectItem value="high"><span className="text-red-600">優先度: 高</span></SelectItem>
                      <SelectItem value="medium"><span className="text-yellow-600">優先度: 中</span></SelectItem>
                      <SelectItem value="low"><span className="text-gray-600">優先度: 低</span></SelectItem>
                    </SelectContent>
                  </Select>
                  <Popover>
                    <ControlHint label={`ラベル（${selectedLabelIds.length}件）`} description={selectedLabelIds.length ? selectedLabelIds.map(id => labels.find(item => item.id === id)?.name ?? '名前を確認できないラベル').join('、') : 'ラベルを選択します。'}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size={selectedLabelIds.length ? 'sm' : 'icon'} aria-label={`ラベル（${selectedLabelIds.length}件）`} className={cn('max-w-full shrink-0 text-muted-foreground', selectedLabelIds.length ? 'h-auto min-h-8 whitespace-normal px-1 py-1' : 'h-8 w-8')}>
                          {selectedLabelIds.length ? <span className="flex min-w-0 flex-wrap gap-1">{selectedLabelIds.map(id => {
                            const label = labels.find(item => item.id === id);
                            return <span key={id} className="inline-flex min-w-0 items-center gap-1.5 rounded bg-muted px-2 py-1 text-xs text-foreground"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: label?.color ?? 'currentColor' }} /><span className="break-words">{label?.name ?? '名前を確認できないラベル'}</span></span>;
                          })}</span> : <TagIcon aria-hidden="true" className="h-4 w-4" />}
                        </Button>
                      </PopoverTrigger>
                    </ControlHint>
                    <PopoverContent className="w-64" align="start" aria-label="ラベルを選択">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">ラベルを選択</p>
                        {labels.map((label) => (
                          <button
                            key={label.id}
                            onClick={() => handleLabelToggle(label.id)}
                            className={cn(
                              'flex w-full items-center gap-2 rounded px-2 py-1 text-sm transition-colors hover:bg-muted',
                              selectedLabelIds.includes(label.id) && 'bg-muted'
                            )}
                          >
                            <div
                              className="h-3 w-3 rounded"
                              style={{ backgroundColor: label.color }}
                            />
                            <span>{label.name}</span>
                            {selectedLabelIds.includes(label.id) && (
                              <span className="ml-auto text-primary">✓</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <ControlHint label={`タグ（${task.tagIds?.length ?? 0}件）`} description={task.tagIds?.length ? task.tagIds.map(id => projectTags.find(item => item.id === id)?.name ?? '名前を確認できないタグ').join('、') : 'タグを選択します。'}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label={`タグ（${task.tagIds?.length ?? 0}件）`} className={cn('h-8 w-8 shrink-0 text-muted-foreground', (task.tagIds?.length ?? 0) > 0 && 'bg-blue-50 text-blue-700')}>
                          <Bookmark aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                    </ControlHint>
                    <PopoverContent className="max-h-[min(32rem,calc(100dvh-4rem))] w-72 overflow-y-auto" align="start" aria-label="タグを選択">
                      <div className="space-y-3">
                        <p className="text-sm font-medium">タグを選択</p>
                        <div className="space-y-1">
                          {projectTags.map((tag) => (
                            <button
                              key={tag.id}
                              onClick={() => handleTagToggle(tag.id)}
                              className={cn(
                                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-muted',
                                task?.tagIds?.includes(tag.id) && 'bg-muted'
                              )}
                            >
                              <Badge
                                className="text-white text-xs"
                                style={{ backgroundColor: tag.color }}
                              >
                                {tag.name}
                              </Badge>
                              {task?.tagIds?.includes(tag.id) && (
                                <Check className="ml-auto h-4 w-4 text-primary" />
                              )}
                            </button>
                          ))}
                        </div>
                        <Separator />
                        {isAddingTag ? (
                          <div className="space-y-2">
                            <Input
                              value={newTagName}
                              onChange={(e) => setNewTagName(e.target.value)}
                              placeholder="タグ名を入力..."
                              className="h-8"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return;
                                if (e.key === 'Enter') handleCreateTag();
                                if (e.key === 'Escape') {
                                  setIsAddingTag(false);
                                  setNewTagName('');
                                }
                              }}
                            />
                            <div className="flex min-w-0 flex-wrap gap-1">
                              {TAG_COLORS.map((color) => (
                                <button
                                  key={color.value}
                                  onClick={() => setNewTagColor(color.value)}
                                  className={cn(
                                    'h-5 w-5 rounded transition-transform hover:scale-110',
                                    newTagColor === color.value && 'ring-2 ring-offset-1 ring-primary'
                                  )}
                                  style={{ backgroundColor: color.value }}
                                />
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={handleCreateTag}>
                                作成
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setIsAddingTag(false);
                                  setNewTagName('');
                                }}
                              >
                                キャンセル
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsAddingTag(true)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            <Plus className="h-4 w-4" />
                            新しいタグを作成
                          </button>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="flex flex-wrap items-start gap-2 py-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => addChecklist('チェックリスト')}>
                    <ListChecks className="h-4 w-4" aria-hidden="true" />チェックリスト
                  </Button>
                  {user && onAddSubtask && <TaskSubtaskCreator key={`subtask:${user.id}/${task.projectId}/${task.id}`} task={task} onAdd={onAddSubtask} />}
                </div>
              </div>

              <TaskRelations task={task} tasks={allTasks} names={Object.fromEntries(localMembers.users.map(member => [member.id, member.displayName]))} members={Object.fromEntries(localMembers.users.map(member => [member.id, member]))} onDeleteSubtask={user ? onDeleteSubtask : undefined} onAddSubtask={user ? onAddSubtask : undefined} onReorderSubtasks={user ? handleSubtaskReorder : undefined} />

              {/* Checklists */}
              {checklists.length > 0 && (
                <div className="mt-3 space-y-2">
                  {checklists.map((checklist) => (
                    <ChecklistCard
                      key={`${projectId}/${task.id}/${checklist.id}`}
                      checklist={checklist}
                      isExpanded={expandedChecklists.has(checklist.id)}
                      onToggleExpand={() => toggleChecklistExpanded(checklist.id)}
                      onDelete={() => removeChecklist(checklist.id)}
                      onRename={newTitle => editChecklist(checklist.id, { title: newTitle })}
                      onAddItem={(text) => addChecklistItem(checklist.id, text)}
                      onToggleItem={(itemId) => toggleChecklistItem(checklist.id, itemId)}
                      onDeleteItem={(itemId) => removeChecklistItem(checklist.id, itemId)}
                      onEditItemText={(itemId, text, expectedText) => editChecklistItemText(checklist.id, itemId, text, expectedText)}
                      onDeadline={(itemId, value) => setChecklistItemDeadline(checklist.id, itemId, value)}
                      onMoveItem={(itemId, targetId) => moveChecklistItem(checklist.id, itemId, targetId)}
                      progress={getChecklistProgress(checklist)}
                    />
                  ))}
                </div>
              )}



              {/* Comments Section */}
              <div className="mt-3">

                {/* Comment List */}
                {comments.length > 0 && (
                  <div className="mb-3 space-y-2">
                    {comments.map((comment) => {
                      const author = commentAuthors[comment.authorId];
                      const authorName = comment.authorLabel || author?.displayName || 'Unknown';
                      const authorInitials = authorName.slice(0, 2).toUpperCase();
                      const authorAvatarText = comment.authorIcon || authorInitials;
                      const isEditing = editingCommentId === comment.id;
                      const isEdited = comment.updatedAt && comment.updatedAt.getTime() !== comment.createdAt.getTime();
                      return (
                        <div key={comment.id} id={`task-comment-${comment.id}`} className={cn('group flex gap-3 rounded-lg', highlightCommentId === comment.id && 'bg-blue-50 ring-2 ring-blue-300')}>
                          <div className="h-8 w-8 flex-shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-medium overflow-hidden">
                            {comment.authorIcon ? (
                              <span className="text-sm">{authorAvatarText}</span>
                            ) : author?.photoURL ? (
                              <Image
                                src={author.photoURL}
                                alt={authorName}
                                width={32}
                                height={32}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              authorAvatarText
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium">{authorName}</span>
                              <span className="text-xs text-muted-foreground">
                                {format(comment.createdAt, 'M/d HH:mm', { locale: ja })}
                                {isEdited && ' (編集済み)'}
                              </span>
                              {(comment.purpose === 'memo' || comment.purpose === 'review_request') && <span aria-label={`投稿の用途：${COMMENT_PURPOSE_LABELS[comment.purpose]}`} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{COMMENT_PURPOSE_LABELS[comment.purpose]}</span>}
                              {!isEditing && !comment.reviewTaskId && (
                                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      setEditingCommentId(comment.id);
                                      setEditingCommentText(comment.content);
                                    }}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (confirm('このコメントを削除しますか？')) {
                                        removeComment(comment.id);
                                      }
                                    }}
                                    className="text-muted-foreground hover:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                            {isEditing ? (
                              <div className="rounded-lg border p-2">
                                <Textarea
                                  value={editingCommentText}
                                  onChange={(e) => setEditingCommentText(e.target.value)}
                                  rows={3}
                                  className="resize-none break-all border-none p-0 shadow-none focus-visible:ring-0"
                                  autoFocus
                                />
                                <div className="mt-2 flex gap-2">
                                  <Button
                                    size="sm"
                                    onClick={async () => {
                                      if (editingCommentText.trim()) {
                                        await editComment(comment.id, editingCommentText.trim());
                                        setEditingCommentId(null);
                                        setEditingCommentText('');
                                      }
                                    }}
                                  >
                                    保存
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingCommentId(null);
                                      setEditingCommentText('');
                                    }}
                                  >
                                    キャンセル
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-lg bg-muted px-3 pb-3 pt-2">
                                {comment.content && (
                                  <p className="break-all whitespace-pre-wrap text-sm leading-relaxed">{linkifyText(comment.content)}</p>
                                )}
                                {comment.reviewTaskId && (() => { const review = reviews.find(item=>item.id===comment.reviewTaskId); return review && user ? <TaskWorkflow key={review.id} task={review} tasks={allTasks} userId={user.id} names={Object.fromEntries(localMembers.users.map(member=>[member.id,member.displayName]))} availableAttachments={comment.attachments ?? []} /> : <p className="mt-2 text-xs text-amber-800">この確認依頼の保存記録は見つかりません。元のコメントを表示しています。</p>; })()}
                                {/* Comment Attachments */}
                                {comment.attachments && comment.attachments.length > 0 && (
                                  <div className={cn("flex flex-wrap gap-2", comment.content && "mt-2")}>
                                    {comment.attachments.map((att) => (
                                      <AttachmentPreviewCompact
                                        key={att.id}
                                        id={att.id}
                                        name={att.name}
                                        url={att.url}
                                        type={att.type}
                                        size={att.size}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {user && <CommentReactions key={`${user.id}:${projectId}:${task.id}:${comment.id}`} userId={user.id} authorId={comment.authorId} projectId={projectId} taskId={task.id} commentId={comment.id} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {user && <CommentComposer key={`${user.id}:${projectId}:${task.id}`} projectId={projectId} taskId={task.id} parentAssigneeIds={task.assigneeIds} tasks={allTasks} authorId={user.id} authorName={user.displayName || 'メンバー'} members={localMembers} />}
              </div>
            </div>
          </DetailBody>

          {/* Footer */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t px-6 py-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span>
                タスク作成: {task.createdAt ? format(task.createdAt, 'yyyy年M月d日 HH:mm', { locale: ja }) : '-'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <TaskArchiveButton key={task.id} projectId={projectId} taskId={task.id} taskTitle={task.title} userId={user?.id} onArchived={onClose} />
              {onDuplicate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDuplicate}
                  className="h-8"
                  title="タスクを複製"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (confirm('このタスクを削除しますか？')) {
                    onDelete();
                  }
                }}
                className="h-8 text-destructive hover:text-destructive"
                aria-label="タスクを削除"
                title="タスクを削除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DetailFrame>
      </DialogContent>
    </Dialog>
  );
}

// Checklist Card Component
interface ChecklistCardProps {
  checklist: Checklist;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  onRename: (title: string) => Promise<void>;
  onAddItem: (text: string) => void;
  onToggleItem: (itemId: string) => void;
  onDeleteItem: (itemId: string) => void;
  onEditItemText: (itemId: string, text: string, expectedText: string) => Promise<void>;
  onDeadline: (itemId: string, value: import('@/lib/utils/checklist-item').ChecklistDeadline) => Promise<void>;
  onMoveItem: (itemId: string, targetId: string) => Promise<void>;
  progress: number;
}

function ChecklistCard({
  checklist,
  isExpanded,
  onToggleExpand,
  onDelete,
  onRename,
  onAddItem,
  onToggleItem,
  onDeleteItem,
  onEditItemText,
  onMoveItem,
  onDeadline,
  progress,
}: ChecklistCardProps) {
  const [newItemText, setNewItemText] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState('');
  const orderPending = useRef(false);

  const handleMove = async (itemId: string, targetId: string) => {
    if (orderPending.current || itemId === targetId) return;
    orderPending.current = true;
    setIsSavingOrder(true);
    setOrderError('');
    try {
      await onMoveItem(itemId, targetId);
    } catch {
      setOrderError('並べ替えを保存できませんでした。表示順は変更していません。接続・権限を確認し、タスクを開き直してから再度お試しください。');
    } finally {
      orderPending.current = false;
      setIsSavingOrder(false);
    }
  };

  const handleAddItem = () => {
    if (newItemText.trim()) {
      onAddItem(newItemText.trim());
      setNewItemText('');
    }
  };

  return (
    <fieldset disabled={isSavingOrder} className="min-w-0 rounded-lg border bg-white" aria-label={checklist.title} aria-busy={isSavingOrder}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <ChecklistTitle title={checklist.title} disabled={isSavingOrder} onSave={onRename} />
          <div className="flex min-w-20 max-w-48 flex-1 items-center gap-2">
            <span className="shrink-0 text-sm tabular-nums text-primary">{progress}%</span>
            <Progress value={progress} className="h-1.5 flex-1" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggleExpand}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Items */}
      {isExpanded && (
        <div className="border-t px-3 py-1">
          {isSavingOrder && <p role="status" className="py-1 text-xs text-muted-foreground">順番を保存中…</p>}
          {orderError && <p role="alert" className="py-1 text-xs text-destructive">{orderError}</p>}
          <SortableChecklistItems items={checklist.items} disabled={isSavingOrder} onMove={handleMove} onToggle={onToggleItem} onDelete={onDeleteItem} onRename={onEditItemText} onDeadline={onDeadline} />

          {/* Add Item */}
          {isAddingItem ? (
            <div className="flex items-center gap-2 py-2">
              <div className="h-4 w-4 rounded border border-muted-foreground/50" />
              <Input
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => {
                  // IME変換中は無視（日本語入力対応）
                  if (e.nativeEvent.isComposing) {
                    return;
                  }
                  if (e.key === 'Enter') {
                    handleAddItem();
                  } else if (e.key === 'Escape') {
                    setIsAddingItem(false);
                    setNewItemText('');
                  }
                }}
                placeholder="アイテムを追加"
                className="h-8 flex-1"
                autoFocus
              />
              <Button size="sm" onClick={handleAddItem}>
                追加
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setIsAddingItem(false);
                  setNewItemText('');
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => setIsAddingItem(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  setIsAddingItem(true);
                }
              }}
              className="flex cursor-pointer items-center gap-3 py-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <div className="h-4 w-4 rounded border border-muted-foreground/50" />
              <span>アイテムを追加</span>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
