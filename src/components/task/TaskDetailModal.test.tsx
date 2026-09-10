import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailModal } from './TaskDetailModal';
import type { Checklist, Comment, Task } from '@/types';
import type { ComponentProps } from 'react';
import type { SortableChecklistItems } from './SortableChecklistItems';
import { CHECKLIST_ASSIGNEE_STORAGE_KEY, useChecklistAssigneeStore } from '@/stores/checklistAssigneeStore';

const mocks = vi.hoisted(() => ({
  sendBellNotification: vi.fn(),
  addComment: vi.fn(),
  comments: [] as Comment[],
  checklists: [] as Checklist[],
  moveChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
  moveFromUI: undefined as ((itemId:string,targetId:string)=>void) | undefined,
}));
vi.mock('./SortableChecklistItems', async importOriginal => {
  const actual = await importOriginal<typeof import('./SortableChecklistItems')>();
  return { SortableChecklistItems: (props: ComponentProps<typeof SortableChecklistItems>) => {
    mocks.moveFromUI = props.onMove;
    return <actual.SortableChecklistItems {...props} />;
  } };
});

vi.mock('@/hooks/useNotifications', () => ({
  useNotifications: () => ({ sendBellNotification: mocks.sendBellNotification }),
}));
vi.mock('@/hooks/useTaskDetails', () => ({
  useTaskDetails: () => ({
    checklists: mocks.checklists,
    comments: mocks.comments,
    addComment: mocks.addComment,
    moveChecklistItem: mocks.moveChecklistItem,
    toggleChecklistItem: mocks.toggleChecklistItem,
    getAllCommentAttachments: () => [],
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/lib/firebase/firestore', () => ({
  getProject: vi.fn().mockResolvedValue({ name: '通知テスト', memberIds: ['user-2'] }),
  getProjectTags: vi.fn().mockResolvedValue([]),
  getUsersByIds: vi.fn().mockResolvedValue([{id:'user-2',displayName:'こずえ'}]),
  createTag: vi.fn(),
}));
vi.mock('./AssigneeSelector', () => ({ AssigneeSelector: () => null }));
vi.mock('./AttachmentPreview', () => ({
  AttachmentPreview: () => null,
  AttachmentPreviewCompact: () => null,
}));

const task: Task = {
  id: 'task-1', projectId: 'project-1', listId: 'list-1', title: '通知の配置確認',
  description: '', order: 0, assigneeIds: ['user-2'], labelIds: [], tagIds: [],
  dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null,
  durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null,
  isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null,
  createdBy: 'user-1', createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

async function renderModal() {
  const onUpdate = vi.fn();
  await act(async () => {
    render(<TaskDetailModal task={task} projectId={task.projectId} lists={[]} labels={[]}
      allTasks={[task]} isOpen onClose={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} />);
  });
  return { onUpdate };
}

describe('TaskDetailModal notification placement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mocks.comments = [];
    mocks.checklists = [];
    localStorage.removeItem(CHECKLIST_ASSIGNEE_STORAGE_KEY);
    useChecklistAssigneeStore.setState({byItem:{},hydrated:false,persistenceFailed:false});
    mocks.sendBellNotification.mockResolvedValue(undefined);
  });

  it('associates the task dialog with a concise screen-reader description', async () => {
    await renderModal();
    const dialog = screen.getByRole('dialog');
    const descriptionId = dialog.getAttribute('aria-describedby');
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)).toHaveTextContent(
      'タスクの内容、担当者、日程、チェックリスト、コメントを確認・編集します。'
    );
  });

  it('connects checklist moves, locks pending operations and displays failures without changing items', async () => {
    mocks.checklists = [{ id:'checklist', taskId:task.id, title:'準備', order:0, createdAt:new Date(), items:[
      {id:'a',text:'シール',isChecked:false,order:0},
      {id:'b',text:'箱',isChecked:true,order:1},
    ] }];
    let rejectSave!: (reason: Error) => void;
    mocks.moveChecklistItem.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectSave = reject; }));
    const { onUpdate } = await renderModal();
    await screen.findByRole('button', { name:'箱をドラッグして並べ替え' });
    act(() => { mocks.moveFromUI?.('b','a'); });
    expect(mocks.moveChecklistItem).toHaveBeenCalledExactlyOnceWith('checklist','b','a');
    expect(screen.getByText('順番を保存中…')).toHaveAttribute('role','status');
    expect(screen.getByRole('checkbox', { name:'箱の完了' })).toBeDisabled();
    act(() => { mocks.moveFromUI?.('b','a'); });
    expect(mocks.moveChecklistItem).toHaveBeenCalledTimes(1);
    await act(async () => rejectSave(new Error('offline')));
    expect(await screen.findByRole('alert')).toHaveTextContent('並べ替えを保存できません');
    expect(screen.getByRole('checkbox', { name:'箱の完了' })).toBeChecked();
    expect(mocks.checklists[0].items.map(item => item.id)).toEqual(['a','b']);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(mocks.toggleChecklistItem).not.toHaveBeenCalled();
    expect(mocks.sendBellNotification).not.toHaveBeenCalled();
    mocks.moveChecklistItem.mockResolvedValueOnce(undefined);
    act(() => { mocks.moveFromUI?.('b','a'); });
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name:'箱をドラッグして並べ替え' })).toBeEnabled());
  });

  it('assigns a checklist item locally without updating the shared task, completion, or notifications', async () => {
    mocks.checklists = [{id:'c',taskId:task.id,title:'準備',order:0,createdAt:new Date(),items:[{id:'i',text:'チケット購入',isChecked:false,order:0}]}];
    const original=structuredClone(mocks.checklists);
    const {onUpdate}=await renderModal();
    fireEvent.blur(screen.getByDisplayValue(task.title));
    fireEvent.click(await screen.findByRole('button',{name:'チケット購入の担当者（このブラウザのみ）'}));
    fireEvent.click(await screen.findByRole('checkbox',{name:'こずえ'}));
    expect(Object.values(useChecklistAssigneeStore.getState().byItem)).toEqual([['user-2']]);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(mocks.toggleChecklistItem).not.toHaveBeenCalled();
    expect(mocks.sendBellNotification).not.toHaveBeenCalled();
    expect(mocks.checklists).toEqual(original);
  });

  it.each([false, true])('puts notification and review options inside the composer (existing comments: %s)', async (hasComments) => {
    if (hasComments) {
      mocks.comments = [{
        id: 'comment-1', taskId: task.id, content: '既存コメント', authorId: 'user-2',
        mentions: [], createdAt: task.createdAt, updatedAt: task.updatedAt,
      }];
    }
    const original = structuredClone(task);
    const { onUpdate } = await renderModal();
    const composer = screen.getByRole('region', { name: 'コメント投稿' });
    expect(within(composer).getByRole('checkbox', { name: 'メンバーに通知' })).toBeInTheDocument();
    expect(within(composer).getByRole('checkbox', { name: '確認依頼' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'メンバーに通知' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通知を送信' })).not.toBeInTheDocument();
    fireEvent.click(within(composer).getByRole('checkbox', { name: 'メンバーに通知' }));
    expect(await within(composer).findByRole('checkbox', { name: 'こずえ' })).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(task).toEqual(original);
    expect(mocks.sendBellNotification).not.toHaveBeenCalled();
    expect(mocks.addComment).not.toHaveBeenCalled();
  });
});
