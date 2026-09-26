vi.mock('@/lib/task/workflowClient',()=>({sendWorkflow:vi.fn().mockResolvedValue(null)}));
import { sendWorkflow } from '@/lib/task/workflowClient';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useProjectMilestones', () => ({ useProjectMilestones: () => ({ milestones: [], isLoading: false, error: false, selectedId: null, setSelectedId: vi.fn() }) }));
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskDetailModal } from './TaskDetailModal';
import type { Checklist, Comment, Task } from '@/types';
import type { ComponentProps } from 'react';
import type { SortableChecklistItems } from './SortableChecklistItems';
import { CHECKLIST_ASSIGNEE_STORAGE_KEY, useChecklistAssigneeStore } from '@/stores/checklistAssigneeStore';
import { viewList } from '@/test/taskViewFixtures';

const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // Radix scrolls the focused option; jsdom does not implement this browser API.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});

const mocks = vi.hoisted(() => ({
  sendBellNotification: vi.fn(),
  addComment: vi.fn(),
  addChecklist: vi.fn().mockResolvedValue(undefined),
  comments: [] as Comment[],
  checklists: [] as Checklist[],
  moveChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
  editChecklist: vi.fn(),
  editChecklistItemText: vi.fn(),
  setChecklistItemDueDate: vi.fn(),
  setChecklistItemDeadline: vi.fn().mockResolvedValue(undefined),
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
    addChecklist: mocks.addChecklist,
    moveChecklistItem: mocks.moveChecklistItem,
    toggleChecklistItem: mocks.toggleChecklistItem,
    editChecklist: mocks.editChecklist,
    editChecklistItemText: mocks.editChecklistItemText,
    setChecklistItemDueDate: mocks.setChecklistItemDueDate,
    setChecklistItemDeadline: mocks.setChecklistItemDeadline,
    getAllCommentAttachments: () => [],
  }),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@/lib/firebase/firestore', () => ({
  getProject: vi.fn().mockResolvedValue({ name: '通知テスト', description: '重複するプロジェクトの説明', memberIds: ['user-2'] }),
  getProjectTags: vi.fn().mockResolvedValue([]),
  getUsersByIds: vi.fn().mockResolvedValue([{id:'user-2',displayName:'こずえ'}]),
  createTag: vi.fn(),
}));
vi.mock('./TaskAutomationPanel', () => ({ TaskAutomationPanel: () => null }));
vi.mock('@/hooks/useTaskHistory', () => ({ useTaskHistory: () => ({ page: null, error: null, busy: false, refresh: vi.fn(), more: vi.fn() }) }));
vi.mock('./CommentReactions', () => ({ CommentReactions: () => <div aria-label="コメントのスタンプ" /> }));
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

async function renderModal(props: Partial<ComponentProps<typeof TaskDetailModal>> = {}) {
  const onUpdate = vi.fn();
  await act(async () => {
    render(<TaskDetailModal task={task} projectId={task.projectId} lists={[]} labels={[]}
      allTasks={[task]} isOpen onClose={vi.fn()} onUpdate={onUpdate} onDelete={vi.fn()} {...props} />);
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
    expect(dialog.querySelector('.tf-detail-header')).toHaveClass('pt-5', 'pb-1');
  });

  it('completes an ordinary task beside the status menu without adding a new row', async () => {
    const { onUpdate } = await renderModal();
    const state = screen.getByRole('group', { name: '状態' });
    const complete = within(state).getByRole('button', { name: '完了' });
    expect(within(state).getByRole('combobox', { name: `${task.title}のステータス` }).compareDocumentPosition(complete) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(complete).toBeEnabled());
    fireEvent.click(complete);
    await waitFor(() => expect(sendWorkflow).toHaveBeenCalledWith(task.projectId, task.id, expect.objectContaining({ action: 'complete' })));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('explains why a task with an unfinished prerequisite cannot be completed', async () => {
    const prerequisite = { ...task, id: 'prerequisite', title: '前提の作業' };
    const dependent = { ...task, dependsOnTaskIds: [prerequisite.id] };
    await renderModal({ task: dependent, allTasks: [dependent, prerequisite] });
    expect(screen.getByRole('button', { name: '完了' })).toBeDisabled();
    expect(screen.getByText('前提の完了待ち：前提の作業')).toBeVisible();
    expect(sendWorkflow).not.toHaveBeenCalled();
  });

  it('changes its display width without saving and moves lists only after explicit confirmation', async () => {
    const onMoveTask = vi.fn().mockResolvedValue(undefined);
    const { onUpdate } = await renderModal({ onMoveTask, lists: [viewList({ name: '準備' }), viewList({ id: 'done', name: '完了', autoCompleteOnEnter: true })] });
    fireEvent.click(screen.getByRole('button', { name: 'タスク詳細の幅を広げる' }));
    expect(screen.getByRole('button', { name: 'タスク詳細の幅を戻す' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: `${task.title}のリストを変更` }));
    fireEvent.change(screen.getByRole('combobox', { name: '移動先のリスト' }), { target: { value: 'done' } });
    expect(screen.getByText('移動先の設定により、このタスクは完了になります。')).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onMoveTask).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '移動' }));
    await waitFor(() => expect(onMoveTask).toHaveBeenCalledExactlyOnceWith(task.id, 'done'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('offers parent reassignment for standalone tasks through the dedicated save operation', async () => {
    const onChangeParent = vi.fn().mockResolvedValue(undefined);
    const { onUpdate } = await renderModal({ onChangeParent, allTasks: [task, { ...task, id: 'parent', title: '親候補' }] });
    const context = screen.getByRole('group', { name: 'リストと親タスク' });
    fireEvent.click(within(context).getByRole('button', { name: /親タスクを変更/ }));
    fireEvent.change(screen.getByRole('combobox', { name: '新しい親タスク' }), { target: { value: 'parent' } });
    expect(onChangeParent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '変更' }));
    await waitFor(() => expect(onChangeParent).toHaveBeenCalledExactlyOnceWith(task.id, 'parent'));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('selects each priority from the icon menu and can clear it without changing other fields', async () => {
    const { onUpdate } = await renderModal();
    for (const [label, value] of [['高', 'high'], ['中', 'medium'], ['低', 'low'], ['なし', null]] as const) {
      const previousCalls = onUpdate.mock.calls.length;
      fireEvent.keyDown(screen.getByRole('combobox', { name: /^優先度:/ }), { key: 'Enter' });
      const menu = await screen.findByRole('listbox');
      expect(within(menu).getAllByRole('option')).toHaveLength(4);
      expect(onUpdate).toHaveBeenCalledTimes(previousCalls);
      fireEvent.click(within(menu).getByRole('option', { name: `優先度: ${label}` }));
      await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
      expect(onUpdate).toHaveBeenCalledTimes(previousCalls + 1);
      expect(onUpdate).toHaveBeenLastCalledWith({ priority: value });
      expect(screen.getByRole('combobox', { name: `優先度: ${label}` })).toBeInTheDocument();
    }
  });

  it('opens metadata controls without saving and retains label selection and tag creation entry', async () => {
    const { onUpdate } = await renderModal({ labels: [{ id: 'label-1', projectId: task.projectId, name: '資料', color: '#2563eb', createdAt: task.createdAt }] });
    const controls = within(screen.getByRole('group', { name: '担当者・依存タスク・優先度・ラベル・タグ' }));
    fireEvent.click(controls.getByRole('button', { name: '依存タスク（0件）' }));
    const dependencies = screen.getByRole('dialog', { name: '依存タスクを選択' });
    expect(within(dependencies).getByText('他にタスクがありません')).toBeInTheDocument();
    fireEvent.keyDown(dependencies, { key: 'Escape' });
    fireEvent.click(controls.getByRole('button', { name: 'タグ（0件）' }));
    const tags = screen.getByRole('dialog', { name: 'タグを選択' });
    fireEvent.click(within(tags).getByRole('button', { name: '新しいタグを作成' }));
    expect(within(tags).getByPlaceholderText('タグ名を入力...')).toBeInTheDocument();
    fireEvent.click(within(tags).getByRole('button', { name: 'キャンセル' }));
    fireEvent.keyDown(tags, { key: 'Escape' });
    fireEvent.click(controls.getByRole('button', { name: 'ラベル（0件）' }));
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog', { name: 'ラベルを選択' })).getByRole('button', { name: '資料' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ labelIds: ['label-1'] });
  });

  it('shows configured label names before opening their selector, including unavailable labels', async () => {
    const { onUpdate } = await renderModal({
      task: { ...task, labelIds: ['label-1', 'unavailable'] },
      labels: [{ id: 'label-1', projectId: task.projectId, name: '資料', color: '#2563eb', createdAt: task.createdAt }],
    });
    const trigger = screen.getByRole('button', { name: 'ラベル（2件）' });
    expect(within(trigger).getByText('資料')).toBeVisible();
    expect(within(trigger).getByText('名前を確認できないラベル')).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'ラベルを選択' })).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([false, true])('keeps recurrence settings inside the deadline popup (configured: %s)', async configured => {
    const recurrence = configured ? { seriesId: 'series-1', unit: 'month' as const, interval: 1, anchorDate: '2026-01-31', occurrence: 0, endDate: null, listId: 'list-1' } : null;
    const { onUpdate } = await renderModal({ task: { ...task, dueDate: new Date('2026-01-31T00:00:00+09:00'), recurrence }, lists: [viewList({ id: 'list-1' })] });
    expect(!!screen.queryByRole('button', { name: '繰り返しを設定' })).toBe(configured);
    expect(!!screen.queryByRole('img', { name: '繰り返し：1か月ごと' })).toBe(configured);
    fireEvent.click(screen.getByRole('button', { name: /^期限:/ }));
    const popup = within(screen.getByRole('dialog', { name: '期限の設定' }));
    expect(popup.getByRole('grid')).toBeVisible();
    fireEvent.click(popup.getByRole('button', { name: /^繰り返し/ }));
    const settings = popup.getByRole('group', { name: '繰り返しの設定' });
    expect(settings).toBeVisible();
    expect(popup.queryByRole('dialog')).not.toBeInTheDocument();
    if (configured) fireEvent.click(within(settings).getByRole('button', { name: '設定を変更' }));
    expect(within(settings).getByLabelText('基準日（今回分）')).toHaveValue('2026-01-31');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('opens history on arrival from recent work and still lets the user collapse it without saving', async () => {
    const { onUpdate } = await renderModal({ openHistory: true });
    const history = screen.getByRole('region', { name: 'このタスクの経緯' });
    expect(history).toBeVisible();
    fireEvent.click(screen.getByText('経緯・変更履歴を見る'));
    expect(history).not.toBeVisible();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('uses one description field and lets history open nearby without changing the task', async () => {
    const { onUpdate } = await renderModal({ task: { ...task, description: '手続きの内容' } });
    const section = screen.getByRole('region', { name: '説明と経緯' });
    expect(within(section).getByRole('textbox', { name: '説明' })).toHaveValue('手続きの内容');
    expect(screen.queryByRole('button', { name: /説明を追加|説明を編集/ })).not.toBeInTheDocument();
    expect(within(section).getByRole('region', { name: 'このタスクの経緯' })).not.toBeVisible();
    fireEvent.click(within(section).getByText('経緯・変更履歴を見る'));
    expect(within(section).getByRole('region', { name: 'このタスクの経緯' })).toBeVisible();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(within(section).getByRole('textbox', { name: '説明' }), { target: { value: '進捗と完了条件' } });
    fireEvent.blur(within(section).getByRole('textbox', { name: '説明' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ description: '進捗と完了条件' });
  });

  it('opens archived tasks read-only with a restoration control', async () => {
    const { onUpdate } = await renderModal({ task: { ...task, isArchived: true } });
    expect(screen.getByText('アーカイブしたタスク')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '復元' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
  it.each([
    { name: 'yesterday and unfinished', offset: -1, patch: {}, overdue: true },
    { name: 'due today', offset: 0, patch: {}, overdue: false },
    { name: 'due tomorrow', offset: 1, patch: {}, overdue: false },
    { name: 'no deadline', offset: null, patch: {}, overdue: false },
    { name: 'already completed', offset: -1, patch: { isCompleted: true }, overdue: false },
    { name: 'already abandoned', offset: -1, patch: { isAbandoned: true }, overdue: false },
  ])('keeps the summary and editable deadline consistent for $name', async ({ offset, patch, overdue }) => {
    const due = new Date();
    due.setHours(0, 0, 0, 0);
    due.setDate(due.getDate() + (offset ?? 0));
    const { onUpdate } = await renderModal({ task: { ...task, dueDate: offset === null ? null : due, ...patch } });
    const summary = within(screen.getByRole('region', { name: 'いまの状況と次の担当' }));
    const deadline = screen.getByRole('button', { name: /^期限(?::|を設定)/ });
    expect(summary.queryByText(/期限/)).not.toBeInTheDocument();
    expect(deadline).not.toHaveTextContent('期限超過');
    if (overdue) {
      expect(summary.getByText('未着手')).toHaveClass('text-red-700');
      expect(deadline).toHaveAccessibleName(/期限超過/);
      fireEvent.click(deadline);
      expect(screen.getByRole('grid')).toBeVisible();
    } else {
      expect(deadline).not.toHaveAccessibleName(/期限超過/);
    }
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('keeps dependency details in the popup and recalculates dates when a dependency is removed', async () => {
    const early = { ...task, id: 'early', title: '素材の準備', dueDate: new Date(2026, 8, 6) };
    const late = { ...task, id: 'late', title: '原稿の確認', dueDate: new Date(2026, 8, 10) };
    const dependent = { ...task, dependsOnTaskIds: [early.id, late.id], startDate: new Date(2026, 8, 10), dueDate: new Date(2026, 8, 12), durationDays: 3 };
    const circular = { ...task, id: 'circular', title: '公開作業', dependsOnTaskIds: [task.id] };
    const { onUpdate } = await renderModal({ task: dependent, allTasks: [dependent, early, late, circular] });
    expect(screen.queryByText(/開始可能日:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '依存タスク（2件）' }));
    const popup = within(screen.getByRole('dialog', { name: '依存タスクを選択' }));
    expect(popup.getByText('開始可能日: 9/10（依存タスク未完了）')).toBeInTheDocument();
    expect(popup.getByRole('button', { name: '公開作業' })).toBeDisabled();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(popup.getByRole('button', { name: '原稿の確認の依存を解除' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ dependsOnTaskIds: ['early'], startDate: new Date(2026, 8, 6), dueDate: new Date(2026, 8, 8), durationDays: 3, isDueDateFixed: false });
  });

  it('renames the right checklist and keeps Escape within the editor', async () => {
    mocks.checklists = [{ id:'c', taskId:task.id, title:'準備', order:0, createdAt:new Date(), items:[
      {id:'i',text:'持ちものリスト確認',isChecked:false,order:0},
    ] }];
    mocks.editChecklist.mockResolvedValue(undefined);
    mocks.setChecklistItemDueDate.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { onUpdate } = await renderModal({ onClose });
    expect(screen.queryByText(/未完了を上に表示します/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '準備の名前を変更' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'チェックリスト名' }), { target: { value: '当日準備' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'チェックリスト名' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.editChecklist).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '準備の名前を変更' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'チェックリスト名' }), { target: { value: '当日準備' } });
    fireEvent.click(screen.getByRole('button', { name: 'チェックリスト名を保存' }));
    await waitFor(() => expect(mocks.editChecklist).toHaveBeenCalledExactlyOnceWith('c', { title: '当日準備' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'チェックリスト名' })).not.toBeInTheDocument());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('edits an item through its checklist save route and keeps Escape inside the task', async () => {
    mocks.checklists = [{ id: 'c', taskId: task.id, title: '準備', order: 0, createdAt: new Date(), items: [
      { id: 'i', text: '給食確認票とのWチェック', isChecked: false, order: 0 },
    ] }];
    mocks.editChecklistItemText.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const { onUpdate } = await renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: '給食確認票とのWチェックを編集' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'チェック項目名' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.editChecklistItemText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '給食確認票とのWチェックを編集' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'チェック項目名' }), { target: { value: '受領した給食確認票とのWチェック' } });
    fireEvent.click(screen.getByRole('button', { name: '項目名を保存' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'チェック項目名' })).not.toBeInTheDocument());
    expect(mocks.editChecklistItemText).toHaveBeenCalledExactlyOnceWith('c', 'i', '受領した給食確認票とのWチェック', '給食確認票とのWチェック');
    expect(onUpdate).not.toHaveBeenCalled();
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

  it('shows checklist deadlines without creating local assignees or mutating legacy dates', async () => {
    mocks.checklists = [{id:'c',taskId:task.id,title:'準備',order:0,createdAt:new Date(),items:[{id:'i',text:'チケット購入',isChecked:false,order:0,dueDate:'2026-09-15'}]}];
    const original=structuredClone(mocks.checklists);
    const {onUpdate}=await renderModal();
    const checklist = within(screen.getByRole('group', { name: '準備' }));
    expect(checklist.getByRole('checkbox', { name: 'チケット購入の完了' })).toBeVisible();
    expect(checklist.queryByRole('button', { name: /担当/ })).not.toBeInTheDocument();
    expect(checklist.getByRole('button', { name: /チケット購入の期限/ })).toBeVisible();
    expect(checklist.getByText('9/15')).toBeVisible();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(mocks.setChecklistItemDueDate).not.toHaveBeenCalled();
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
    expect(within(composer).getByRole('checkbox', { name: 'こずえ' })).toBeInTheDocument();
    expect(within(composer).getByRole('radio', { name: '確認依頼' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'メンバーに通知' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通知を送信' })).not.toBeInTheDocument();
    fireEvent.click(within(composer).getByRole('checkbox', { name: 'こずえ' }));
    expect(await within(composer).findByRole('checkbox', { name: 'こずえ' })).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(task).toEqual(original);
    expect(mocks.sendBellNotification).not.toHaveBeenCalled();
    expect(mocks.addComment).not.toHaveBeenCalled();
  });
  it('shows saved purposes without classifying legacy comments or altering their review links', async () => {
    const base = { taskId: task.id, authorId: 'user-2', mentions: [], createdAt: task.createdAt, updatedAt: task.updatedAt };
    mocks.comments = [
      { ...base, id: 'old', content: '昔のコメント', reviewTaskId: 'existing-review' },
      { ...base, id: 'memo', content: '今回の記録', purpose: 'memo' },
      { ...base, id: 'review', content: '新しい確認', purpose: 'review_request', reviewTaskId: 'new-review' },
    ];
    await renderModal();
    expect(screen.getByLabelText('投稿の用途：共有メモ・報告')).toBeInTheDocument();
    expect(screen.getByLabelText('投稿の用途：確認依頼')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^投稿の用途：/)).toHaveLength(2);
    expect(screen.getAllByText('この確認依頼の保存記録は見つかりません。元のコメントを表示しています。')).toHaveLength(2);
  });

  it('renders reflected Moai notes with the Moai label and icon', async () => {
    mocks.comments = [{
      id: 'moai-note', taskId: task.id, authorId: 'user-2', authorLabel: 'モアイ', authorIcon: '🤖',
      content: '担当者を確認しました。', purpose: 'memo', mentions: [],
      createdAt: task.createdAt, updatedAt: task.createdAt,
    }];

    await renderModal();

    const comment = document.getElementById('task-comment-moai-note');
    expect(comment).not.toBeNull();
    expect(within(comment as HTMLElement).getByText('モアイ')).toBeInTheDocument();
    expect(within(comment as HTMLElement).getByText('🤖')).toBeInTheDocument();
    expect(within(comment as HTMLElement).getByText('担当者を確認しました。')).toBeInTheDocument();
    expect(within(comment as HTMLElement).queryByRole('img')).not.toBeInTheDocument();
  });
});

 it('opens the same deadline settings expanded from the schedule repeat icon without saving', async () => {
   const { onUpdate } = await renderModal({ task: { ...task, recurrence: { seriesId: 'series-1', unit: 'month', interval: 1, anchorDate: '2026-01-31', occurrence: 0, endDate: null, listId: 'list-1' } }, lists: [viewList()] });
   fireEvent.click(within(screen.getByRole('group', { name: '日程' })).getByRole('button', { name: '繰り返しを設定' }));
   const popup = within(screen.getByRole('dialog', { name: '期限の設定' }));
   expect(popup.getByRole('group', { name: '繰り返しの設定' })).toBeVisible();
   expect(popup.getByRole('grid')).toBeVisible();
   expect(onUpdate).not.toHaveBeenCalled();
 });
 it('places subtasks above checklists, counts subtasks, and deletes without closing the parent', async () => {
   mocks.checklists = [{ id: 'c', taskId: task.id, title: '準備', order: 0, createdAt: new Date(), items: [
     { id: 'i', text: '手順その1', isChecked: true, order: 0 },
     { id: 'j', text: '手順その2', isChecked: true, order: 1 },
     { id: 'k', text: '手順その3', isChecked: false, order: 2 },
   ] }];
   const onDeleteSubtask = vi.fn().mockResolvedValue(undefined);
   const onDelete = vi.fn();
   const onClose = vi.fn();
   const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
   try {
     await renderModal({ onDeleteSubtask, onDelete, onClose, allTasks: [task,
       { ...task, id: 'child', title: '金額を確認', parentTaskId: task.id },
       { ...task, id: 'done', title: '完了した作業', parentTaskId: task.id, isCompleted: true },
     ] });
     const subtaskList = screen.getByRole('region', { name: 'サブタスク' });
     const checklist = screen.getByRole('group', { name: '準備' });
     expect(subtaskList.compareDocumentPosition(checklist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
     expect(screen.getByText('サブタスク 1/2件完了')).toBeVisible();
     expect(screen.queryByText('手順 2/3件完了')).not.toBeInTheDocument();
     expect(screen.queryByText(/目的：/)).not.toBeInTheDocument();
     expect(screen.queryByRole('button', { name: '完了条件・役割・節目を編集' })).not.toBeInTheDocument();
     fireEvent.click(within(subtaskList).getByRole('button', { name: '金額を確認を削除' }));
     await waitFor(() => expect(sendWorkflow).toHaveBeenCalledWith(task.projectId, 'child', expect.objectContaining({action:'archive'})));
     expect(onDelete).not.toHaveBeenCalled();
     expect(onClose).not.toHaveBeenCalled();
     expect(screen.getByRole('dialog')).toBeVisible();
   } finally { confirm.mockRestore(); }
 });

 it('offers separate checklist and subtask additions in task details', async () => {
   const onAddSubtask = vi.fn().mockResolvedValue('new-child');
   await renderModal({ onAddSubtask });
   fireEvent.click(screen.getByRole('button', { name: 'チェックリスト' }));
   expect(mocks.addChecklist).toHaveBeenCalledWith('チェックリスト');
   fireEvent.click(screen.getByRole('button', { name: 'サブタスク' }));
   fireEvent.change(screen.getByRole('textbox', { name: 'サブタスク名' }), { target: { value: '金額を確認' } });
   await waitFor(() => expect(screen.getByRole('button', { name: '追加' })).toBeEnabled());
   fireEvent.submit(screen.getByRole('form', { name: 'サブタスクの追加' }));
   await waitFor(() => expect(onAddSubtask).toHaveBeenCalledExactlyOnceWith(task, '金額を確認', task.assigneeIds));
 });


describe('task schedule input validation', () => {
  const scheduled = { ...task, startDate: new Date(2026, 8, 15), dueDate: new Date(2026, 8, 16) };
  const dayButton = (day: number) => document.querySelector<HTMLButtonElement>('button[data-day="' + new Date(2026, 8, day).toLocaleDateString() + '"]')!;
  it('disables starts after the deadline while allowing the same day', async () => {
    const { onUpdate } = await renderModal({ task: scheduled });
    fireEvent.click(screen.getByRole('button', { name: '開始: 9/15' }));
    expect(dayButton(20)).toBeDisabled();
    expect(dayButton(16)).toBeEnabled();
    fireEvent.click(dayButton(20)); expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(dayButton(16));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({startDate:new Date(2026,8,16)}));
  });
  it('disables deadlines before the start and restores the old value if a concurrent save is rejected', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('開始日は期限以前の日付にしてください。'));
    await renderModal({ task: scheduled, onUpdate });
    fireEvent.click(await screen.findByRole('button', { name: /^期限: 9\/16/ }));
    expect(dayButton(14)).toBeDisabled(); expect(dayButton(15)).toBeEnabled();
    fireEvent.click(dayButton(17));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('開始日は期限以前'));
    fireEvent.keyDown(screen.getByRole('dialog', {name:'期限の設定'}), {key:'Escape'});
    await waitFor(() => expect(screen.getByRole('button', {name:/^期限: 9\/16/})).toBeInTheDocument());
  });
  it('shows an existing inverted date at its settings without changing task data on open', async () => {
    const {onUpdate} = await renderModal({task:{...scheduled,startDate:new Date(2026,8,20)}});
    expect(screen.getByRole('alert')).toHaveTextContent('開始日は期限以前');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'project-1', memberIds: ['user-1'], defaultAssigneeId: null }, isLoading: false, error: null }) }));
