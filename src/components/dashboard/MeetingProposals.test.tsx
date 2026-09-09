import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEETING_REVIEW_STORAGE_KEY, useMeetingProposalStore } from '@/stores/meetingProposalStore';
import { MEETING_CHECKLIST_STORAGE_KEY, useMeetingChecklistStore } from '@/stores/meetingChecklistStore';
import type { DashboardTask } from '@/lib/dashboard/brief';
import { MeetingProposals } from './MeetingProposals';

const projectState = vi.hoisted(() => ({ projects: [{ id: 'p', name: '展示会出展', memberIds: ['nao', 'ko', 'ka'], icon: '🎮', color: '#123456' }, { id: 'r', name: 'ウリャマ', icon: '🦙', color: '#654321' }], isLoading: false, error: null }));
vi.mock('@/hooks/useProjects', () => ({ useProjects: () => projectState }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{id:'nao', displayName:'Naofumi'}, {id:'ko', displayName:'Kozue'}, {id:'ka', displayName:'Kaori'}], isLoading:false, hasError:false, refresh:vi.fn() }) }));
const expand = (title = '出展情報の準備・提出') => fireEvent.click(screen.getByRole('button', { name: title + 'の子タスクを表示' }));
// Any accidental task write through this module fails the test.
vi.mock('@/lib/firebase/firestore', () => new Proxy({}, { get: (_, name) => { throw new Error(`Unexpected Firestore access: ${String(name)}`); } }));
const props = { tasks: [], tasksLoading: false, tasksError: null };
const existing: DashboardTask = {
  id:'t',projectId:'p',projectName:'展示会出展',listId:'l',title:'出展情報提出',description:'',order:0,
  assigneeIds:['nao'],labelIds:[],tagIds:[],dependsOnTaskIds:[],priority:'high',startDate:null,dueDate:new Date(2026,8,13),durationDays:null,isDueDateFixed:false,
  isCompleted:false,completedAt:null,isAbandoned:false,isArchived:false,archivedAt:null,archivedBy:null,
  createdBy:'nao',createdAt:new Date(2026,8,1),updatedAt:new Date(2026,8,1),
};
describe('MeetingProposals review UI', () => {
  beforeEach(() => {
    localStorage.removeItem(MEETING_REVIEW_STORAGE_KEY); useMeetingProposalStore.setState({ reviews: {}, persistenceFailed: false });
    localStorage.removeItem(MEETING_CHECKLIST_STORAGE_KEY); useMeetingChecklistStore.setState({ placements:{},items:{},persistenceFailed:false });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('shows 13 collapsed bundles and expands all 35 children without adopting ideas', () => {
    render(<MeetingProposals {...props} />);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    const toggles = screen.getAllByRole('button', { name: /の子タスクを表示$/ });
    expect(toggles).toHaveLength(13);
    const submissionToggle = screen.getByRole('button', { name: '出展情報の準備・提出の子タスクを表示' });
    act(() => toggles.forEach(button => fireEvent.click(button)));
    expect(screen.getAllByRole('article')).toHaveLength(35);
    expect(screen.getAllByRole('button', { name: '採用' })).toHaveLength(35);
    fireEvent.click(submissionToggle);
    expect(screen.getAllByRole('article')).toHaveLength(28);
  });
  it('expands each attendee and saves all three resolved assignees in the draft', () => {
    render(<MeetingProposals {...props} />);
    expand('参加登録・チケット購入');
    const row = within(screen.getByRole('article', { name: /^EX-9 / }));
    expect(row.getByText(/担当：Naofumi Higashikawauchi・こずえ・脊古香織/)).toBeVisible();
    fireEvent.click(row.getByRole('button', {name:'採用'}));
    expect(useMeetingProposalStore.getState().reviews['EX-9'].edits?.assigneeIds).toEqual(['nao','ko','ka']);
    expect(useMeetingProposalStore.getState().reviews['EX-9'].status).toBe('adopted');
  });
  it('shows project names below each parent heading, distinguishing multiple candidates', () => {
    render(<MeetingProposals {...props} />);
    const cases = [
      ['出展情報の準備・提出', '東京ゲームダンジョン', 'プロジェクト：未照合'],
      ['モニター募集の条件・告知準備', '個人鑑定モニター募集', 'プロジェクト候補：ウリャマ'],
      ['天然石商品の試作・仕様・価格設計', '天然石商品の試作・販売検討', 'プロジェクト候補：Luna*Lis / ウリャマ'],
      ['タスク表示の設計・実装・動作確認', 'TaskFlowのタスク表示改善', 'プロジェクト候補：タスク管理ツール'],
    ];
    for (const [bundleTitle, parentTitle, projectLabel] of cases) {
      const bundle = within(screen.getByRole('region', { name: bundleTitle }));
      const projectLine = bundle.getByText(projectLabel, { exact: false });
      expect(bundle.getByText(parentTitle).nextElementSibling).toBe(projectLine);
      expect(projectLine).toBeVisible();
      expect(bundle.getByText(parentTitle).parentElement?.parentElement).toHaveClass('lg:grid-cols-[220px_minmax(0,1fr)]');
    }
    const llamaLine = within(screen.getByRole('region', { name: 'モニター募集の条件・告知準備' })).getByText('プロジェクト候補：ウリャマ', { exact: false });
    expect(within(llamaLine).getByText('🦙')).toHaveClass('bg-neutral-900', 'text-white');
  });
  it('shows mixed existing/new counts and saves a human-confirmed correspondence', () => {
    render(<MeetingProposals {...props} tasks={[existing]} />);
    const bundle = within(screen.getByRole('region',{name:'出展情報の準備・提出'}));
    expect(bundle.getByText('登録済み候補 1')).toBeVisible();
    expect(bundle.getByText('新規候補 6')).toBeVisible();
    expand();
    fireEvent.click(screen.getByRole('button',{name:'出展情報を一度提出し、提出内容を確認する'}));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('table')).toHaveTextContent('2026-09-13');
    expect(dialog.getByRole('table')).toHaveTextContent('Naofumi');
    fireEvent.click(dialog.getByRole('button',{name:'この登録済みタスクに対応づける'}));
    expect(useMeetingProposalStore.getState().reviews['EX-7'].target).toEqual({mode:'existing',projectId:'p',taskId:'t'});
    fireEvent.click(dialog.getByRole('button',{name:'別の新規タスクとして扱う'}));
    expect(useMeetingProposalStore.getState().reviews['EX-7'].target).toEqual({mode:'new'});
    fireEvent.click(dialog.getByRole('button',{name:'対応づけを自動照合に戻す'}));
    expect(useMeetingProposalStore.getState().reviews['EX-7'].target).toBeUndefined();
  });
  it('searches another existing task from the accessible projects only', () => {
    render(<MeetingProposals {...props} tasks={[existing,{...existing,id:'foreign',projectId:'outside',title:'対象外情報'}]} />);
    expand();
    fireEvent.click(screen.getByRole('button',{name:'出展情報の正式な締切とイベント名を確認する'}));
    fireEvent.click(screen.getByText('別の登録済みタスクを探す'));
    fireEvent.change(screen.getByRole('textbox',{name:'登録済みタスクを検索'}),{target:{value:'情報'}});
    expect(screen.queryByRole('button',{name:/対象外情報/})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'出展情報提出 ／ 展示会出展'}));
    expect(useMeetingProposalStore.getState().reviews['EX-1'].target).toEqual({mode:'existing',projectId:'p',taskId:'t'});
  });
  it('lets reviewers choose multiple assignees and preserves their IDs', () => {
    render(<MeetingProposals {...props} />);
    expand('参加登録・チケット購入');
    fireEvent.click(within(screen.getByRole('article',{name:/^EX-9 /})).getByRole('button',{name:'直す'}));
    expect(within(screen.getByRole('group',{name:'担当者を複数選択'})).getAllByRole('checkbox').every(input => (input as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole('checkbox',{name:'Kozue'}));
    fireEvent.click(screen.getByRole('button',{name:'下書きを保存'}));
    expect(useMeetingProposalStore.getState().reviews['EX-9'].edits).toMatchObject({assigneeIds:['nao','ka'],owner:'Naofumi・Kaori'});
  });
  it('adopts only a local draft and preserves unanswered questions after reload', () => {
    const { unmount } = render(<MeetingProposals {...props} />);
    expand();
    fireEvent.click(within(screen.getByRole('article', { name: 'EX-1 出展情報の正式な締切とイベント名を確認する' })).getByRole('button', { name: '採用' }));
    expect(screen.getByText(/採用済（未反映） · 編集済 · 要確認事項あり/)).toBeVisible();
    unmount(); render(<MeetingProposals {...props} />); expand();
    expect(screen.getByText(/採用済（未反映） · 編集済 · 要確認事項あり/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '出展情報の正式な締切とイベント名を確認する' }));
    expect(within(screen.getByRole('dialog')).getByText('要確認（未解決）')).toBeVisible();
  });
  it('keeps personal purchase checks independent from adoption and restores them after reload', () => {
    const {unmount} = render(<MeetingProposals {...props}/>);
    expand('参加登録・チケット購入');
    const row = within(screen.getByRole('article',{name:/^EX-9 /}));
    const checks = row.getAllByRole('checkbox');
    expect(checks).toHaveLength(3);
    fireEvent.click(checks[0]);
    expect(checks[0]).toBeChecked();
    expect(checks[1]).not.toBeChecked();
    fireEvent.input(row.getByLabelText('Naofumi Higashikawauchi：チケット購入の子タスク期限'),{target:{value:'2026-09-13'}});
    expect(useMeetingProposalStore.getState().reviews['EX-9']).toBeUndefined();
    unmount(); render(<MeetingProposals {...props}/>);
    expand('参加登録・チケット購入');
    const restored = within(screen.getByRole('article',{name:/^EX-9 /}));
    expect(restored.getAllByRole('checkbox')[0]).toBeChecked();
    expect(restored.getByLabelText('Naofumi Higashikawauchi：チケット購入の子タスク期限')).toHaveValue('2026-09-13');
    expect(restored.getByLabelText('こずえ：チケット購入の子タスク期限')).toHaveValue('');
  });
  it('selects a parent and checklist name without changing correspondence or source tasks', () => {
    const parent = {...existing,id:'parent',title:'東京ゲームダンジョン'};
    const {unmount} = render(<MeetingProposals {...props} tasks={[existing,parent]}/>);
    fireEvent.click(screen.getByRole('button',{name:'出展情報の準備・提出の追加先を設定'}));
    fireEvent.change(screen.getByRole('textbox',{name:'チェックリスト名'}),{target:{value:'提出までの準備'}});
    fireEvent.click(screen.getByRole('button',{name:'追加先を下書きに保存'}));
    expect(useMeetingChecklistStore.getState().placements['ex-submit']).toEqual({projectId:'p',taskId:'parent',title:'提出までの準備'});
    expect(useMeetingProposalStore.getState().reviews).toEqual({});
    expect(parent.title).toBe('東京ゲームダンジョン');
    unmount(); render(<MeetingProposals {...props} tasks={[existing,parent]}/>);
    expect(within(screen.getByRole('region',{name:'出展情報の準備・提出'})).getByText('提出までの準備')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'出展情報の準備・提出の追加先を設定'}));
    fireEvent.click(screen.getByRole('button',{name:'追加先の指定を解除'}));
    expect(useMeetingChecklistStore.getState().placements['ex-submit']).toBeUndefined();
  });
  it('updates a normal child deadline in its review draft and reports checklist save failures', () => {
    render(<MeetingProposals {...props}/>);
    expand();
    const row = within(screen.getByRole('article',{name:/^EX-3 /}));
    fireEvent.change(row.getByLabelText(/の子タスク期限$/),{target:{value:'2026-09-13'}});
    expect(useMeetingProposalStore.getState().reviews['EX-3'].edits?.dueDate).toBe('2026-09-13');
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('quota');});
    fireEvent.click(row.getByRole('checkbox'));
    expect(screen.getByRole('alert')).toHaveTextContent('チェックリストの下書き');
  });
  it('can cancel editing, save corrected fields and undo only this draft', () => {
    render(<MeetingProposals {...props} />);
    expand();
    const row = () => screen.getByRole('article', { name: /^EX-3 / });
    fireEvent.click(within(row()).getByRole('button', { name: '直す' }));
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: '一時修正' } });
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(screen.queryByText('一時修正')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '直す' }));
    fireEvent.change(screen.getByLabelText('件名'), { target: { value: 'キービジュアルの確認版' } });
    fireEvent.change(screen.getByLabelText('担当（未定なら空欄）'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '下書きを保存' }));
    expect(within(screen.getByRole('dialog')).getByText('未確認 · 編集済')).toBeVisible();
    expect(useMeetingProposalStore.getState().reviews['EX-3'].edits?.owner).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'この提案を元の下書きに戻す' }));
    expect(useMeetingProposalStore.getState().reviews['EX-3']).toBeUndefined();
  });
  it('supports hold, dismiss and undo without deleting the proposal', () => {
    render(<MeetingProposals {...props} />);
    expand();
    const row = within(screen.getByRole('article', { name: /^EX-3 / }));
    fireEvent.click(row.getByRole('button', { name: '保留' }));
    expect(row.getByText(/保留中/)).toBeVisible();
    fireEvent.click(row.getByRole('button', { name: '不要' }));
    expect(row.getByRole('button', { name: '不要' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(row.getByRole('button', { name: '未確認に戻す' }));
    expect(row.getByText(/未確認 · 要確認事項あり/)).toBeVisible();
  });
  it('does not classify new work on fetch errors and clearly warns on local-save failure', () => {
    render(<MeetingProposals {...props} tasksError={new Error('offline')} />);
    expand();
    expect(screen.getAllByText('照合待ち')).toHaveLength(7);
    expect(screen.queryByText('新規候補')).not.toBeInTheDocument();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    fireEvent.click(within(screen.getByRole('article', { name: /^EX-3 / })).getByRole('button', { name: '採用' }));
    expect(screen.getByRole('alert')).toHaveTextContent('この画面内だけ');
  });
  it('shows completion criteria, priority, source status and linked dependencies', () => {
    render(<MeetingProposals {...props} />);
    expand();
    fireEvent.click(screen.getByRole('button', { name: '出展情報を一度提出し、提出内容を確認する' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('完了条件：', { exact: true }).parentElement).toHaveTextContent('提出完了を確認し、後から修正可能かを記録する');
    expect(dialog.getByText(/優先度：P1 ／ 作業ステータス：未指定/)).toBeVisible();
    fireEvent.click(dialog.getByRole('button', { name: '親1-6：展示用動画を準備し、動画URLを確定する' }));
    expect(within(screen.getByRole('dialog')).getByText(/担当：未指定 ／ 期限：未指定/)).toBeVisible();
    expect(within(screen.getByRole('dialog')).getByText(/作業ステータス：未着手/)).toBeVisible();
  });
  it('keeps pending confirmations and ideas separate without offering task adoption for ideas', () => {
    render(<MeetingProposals {...props} />);
    expect(screen.getByText(/会議日：2026\/9\/2との記載/)).toBeVisible();
    fireEvent.click(screen.getByText('確認待ち（12項目）'));
    expect(screen.getByText('ホームページ担当者と動画担当者')).toBeVisible();
    fireEvent.click(screen.getByText('検討候補（1件・実行対象外）'));
    fireEvent.click(screen.getByRole('button', { name: 'ウィジェット化・表示カスタマイズを将来候補として整理する' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByRole('button', { name: '採用' })).not.toBeInTheDocument();
    expect(dialog.getByText('コアのタスク表示改善が完了するまで実装しない')).toBeVisible();
  });
});
