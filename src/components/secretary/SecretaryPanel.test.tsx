import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { actMock, createMockSecretary, mockView, reviewMock } from '@/lib/secretary/mock';
import type { SecretaryView } from '@/lib/secretary/types';
import { SecretaryPanel } from './SecretaryPanel';

const data = vi.hoisted(() => ({ view: null as SecretaryView | null, error: null as string | null, busy: false, act: vi.fn(), review: vi.fn(), refresh: vi.fn(), auto: false, setAuto: vi.fn() }));
vi.mock('@/hooks/useSecretary', () => ({ useSecretary: () => data }));
vi.mock('./SecretaryRefreshSettings', () => ({ SecretaryRefreshSettings: () => null }));
vi.mock('./IncomingCandidates', () => ({ IncomingCandidates: () => null, incomingCandidatesStatus: () => 'メール・Chat：未整理' }));
vi.mock('@/components/google/GoogleWorkspacePanel', () => ({ GoogleWorkspaceSummary: () => null }));
const now = '2026-09-12T01:00:00Z';
beforeEach(() => {
  vi.clearAllMocks(); data.error = null; data.busy = false;
  useAuthStore.setState({ user: { id: 'me' } as NonNullable<ReturnType<typeof useAuthStore.getState>['user']> });
  let mock = reviewMock(createMockSecretary('me', now), 'me', now);
  const ready = mock.state.proposals.find(proposal => proposal.key === 'secretary-demo/ready')!;
  mock = actMock(mock, 'me', { action: 'accept', proposalId: ready.id, revision: mock.state.revision }, now);
  data.view = mockView(mock, 'me', now);
  data.view.snapshot.tasks.forEach(t => { t.checklistStatus = 'ready'; t.checklists = []; });
});


function necessary() {
  const view = data.view!;
  const proposal = view.state.proposals.find(p => p.key === 'secretary-demo/draft')!;
  proposal.policyVersion = 2;
  proposal.decision = { question: '速達と通常便のどちらを選びますか？', whyNow: '9/12の発注に本人の選択が必要です。', consequence: '選んだ便で発注を進めます。' };
  return proposal;
}
it('shows registered work even with zero AI proposals; keeps checks and names out of questions', () => {
  const view = data.view!; view.state.proposals = []; view.state.decisions = [];
  const t = view.snapshot.tasks.find(t => t.taskId === 'ready')!;
  t.checklists = [{ id: 'list', title: '準備', items: [{id:'a',text:'持ちもの',isChecked:false},{id:'b',text:'注文済み',isChecked:true}] }];
  const before = structuredClone(view);
  render(<SecretaryPanel compact members={[{id:'me',displayName:'Kozue',photoURL:'/avatar.png'}]} />);
  const ready = screen.getByRole('region', {name:'着手可'});
  expect(ready.querySelector('details')).not.toHaveAttribute('open');
  fireEvent.click(ready.querySelector('summary')!);
  const card = within(ready).getByRole('article',{name:`仕事: ${t.title}`});
  expect(card).toHaveTextContent('持ちもの'); expect(card).not.toHaveTextContent('注文済み');
  expect(within(card).getByRole('group',{name:'担当者: Kozue'})).toBeVisible();
  expect(within(card).queryByText('Kozue')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region',{name:'いま必要な判断'})).queryByRole('article')).not.toBeInTheDocument();
  expect(view).toEqual(before); expect(data.act).not.toHaveBeenCalled();
});
it('keeps deadline and unnecessary actions in the same heading as ready work', () => {
  render(<SecretaryPanel compact />); const ready = screen.getByRole('region',{name:'着手可'});
  fireEvent.click(ready.querySelector('summary')!);
  const card = within(ready).getByRole('article',{name:'仕事: 公開用の紹介文を整える'});
  const heading = within(card).getByTestId('secretary-proposal-heading');
  expect(within(heading).getByRole('button',{name:'期限変更: 公開用の紹介文を整える'})).toBeVisible();
  fireEvent.click(within(heading).getByRole('button',{name:'不要: 公開用の紹介文を整える'}));
  expect(data.act).toHaveBeenCalledWith(expect.objectContaining({action:'unneeded'}));
});
it('suppresses old generic proposals without removing tasks or writing any decisions', () => {
  const before = structuredClone(data.view);
  render(<SecretaryPanel compact />);
  const region = screen.getByRole('region',{name:'いま必要な判断'});
  expect(within(region).queryByRole('article')).not.toBeInTheDocument();
  expect(screen.queryByText('その他の確認候補',{exact:false})).not.toBeInTheDocument();
  expect(screen.queryByText(/再確認日を/)).not.toBeInTheDocument();
  expect(data.view).toEqual(before); expect(data.act).not.toHaveBeenCalled(); expect(data.review).not.toHaveBeenCalled();
});
it('shows why a current choice is needed, what to choose, and its consequence', () => {
  const p = necessary(); render(<SecretaryPanel compact />);
  const card = screen.getByRole('article',{name:'提案: 案内文を仕上げる'});
  expect(card).toHaveTextContent(p.decision!.question); expect(card).toHaveTextContent(p.decision!.whyNow); expect(card).toHaveTextContent(p.decision!.consequence);
  expect(within(card).getByRole('button',{name:'タスクを開く'})).toBeVisible();
  fireEvent.click(within(card).getByText('根拠・訂正・共有への反映'));
  expect(within(card).getByText(p.reason)).toBeVisible();
  fireEvent.change(within(card).getByLabelText('訂正: 案内文を仕上げる'),{target:{value:'通常便に決めました'}});
  fireEvent.click(within(card).getByRole('button',{name:'返答・訂正を保存'}));
  expect(data.act).toHaveBeenCalledWith(expect.objectContaining({action:'correct',correction:'通常便に決めました'}));
});
it('does not duplicate a formal review request with an AI completion question', () => {
  necessary(); const t = data.view!.snapshot.tasks.find(t=>t.taskId==='draft')!;
  t.context = {...t.context!,taskKind:'review_request'};
  render(<SecretaryPanel compact requesterByTask={{[t.key]:{name:'Kozue',isSelf:true}}} />);
  expect(screen.queryByRole('article',{name:`提案: ${t.title}`})).not.toBeInTheDocument();
  expect(data.view!.snapshot.tasks).toContain(t);
});
it.each(['2026-09-12T23:59:59+09:00','2026-09-13T00:00:00+09:00'])('hides stale questions after an update, independent of revisit time: %s', checkedAt => {
  necessary(); data.view!.snapshot.checkedAt=checkedAt;
  data.view!.snapshot.tasks.find(t=>t.taskId==='draft')!.version+=':check-completed';
  render(<SecretaryPanel compact />);
  expect(screen.queryByRole('article',{name:'提案: 案内文を仕上げる'})).not.toBeInTheDocument();
  expect(screen.queryByText(/明日の|再確認日を/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'情報を更新'})); expect(data.refresh).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'AIで整理'})); expect(data.review).toHaveBeenCalledOnce();
});
it('shows unavailable reads as unavailable without asking unsupported questions', () => {
  necessary(); data.view!.snapshot.coverage.status='partial';
  render(<SecretaryPanel compact />);
  expect(screen.getByRole('alert')).toHaveTextContent('一部の情報を取得できていません');
  expect(screen.queryByRole('article',{name:'提案: 案内文を仕上げる'})).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'AIで整理'})).toBeDisabled();
});
it('renders ready and waiting in the supplied left slot, without duplicates', () => {
  const target=document.createElement('div');document.body.append(target);
  const {unmount}=render(<SecretaryPanel compact waitingTarget={target} />);
  for(const name of ['着手可','待ち・保留']) {
    expect(within(target).getByRole('region',{name})).toBeVisible();
    expect(within(screen.getByRole('region',{name:'Neo AI秘書'})).queryByRole('region',{name})).not.toBeInTheDocument();
  } unmount();target.remove();
});
it('shows an optional extra task only after opening the chooser; never starts it automatically', () => {
  render(<SecretaryPanel compact />); const region=screen.getByRole('region',{name:'余裕があるとき'});
  expect(region).not.toHaveTextContent('公開用の紹介文を整える');
  fireEvent.click(within(region).getByRole('button',{name:'今日の一歩'}));
  expect(within(region).getByText('公開用の紹介文を整える')).toBeVisible();
  expect(within(region).getByRole('spinbutton')).not.toBeVisible();
  expect(data.act).not.toHaveBeenCalled();
});
it('preserves accepted holds and their undo when old questions are hidden', () => {
  let mock=reviewMock(createMockSecretary('me',now),'me',now);
  const p=mock.state.proposals.find(p=>p.key==='secretary-demo/draft')!;
  mock=actMock(mock,'me',{action:'accept',proposalId:p.id,revision:mock.state.revision},now);
  data.view=mockView(mock,'me',now); render(<SecretaryPanel compact />);
  const waiting=screen.getByRole('region',{name:'待ち・保留'});
  fireEvent.click(waiting.querySelector('summary')!);
  expect(waiting).toHaveTextContent('案内文を仕上げる');
  fireEvent.click(screen.getByText('AI秘書の履歴・設定'));
  expect(screen.getByRole('button',{name:'採用を戻す'})).toBeEnabled();
  expect(data.act).not.toHaveBeenCalled();
});
it('preserves deadline undo after regeneration removes the original proposal', () => {
  let mock=reviewMock(createMockSecretary('me',now),'me',now);
  const p=mock.state.proposals.find(p=>p.key==='secretary-demo/draft')!;
  mock=actMock(mock,'me',{action:'reschedule',proposalId:p.id,revision:mock.state.revision,dueDate:'2026-10-01'},now);
  mock=reviewMock(mock,'me','2026-09-12T02:00:00Z'); data.view=mockView(mock,'me',now);
  render(<SecretaryPanel compact />);fireEvent.click(screen.getByText('AI秘書の履歴・設定'));
  fireEvent.click(screen.getByRole('button',{name:'期限変更を戻す'}));
  expect(data.act).toHaveBeenCalledWith({action:'undo',proposalId:p.id,revision:mock.state.revision});
});

it('leaves legacy date errors to task settings instead of asking for an AI decision', () => {
  const task = data.view!.snapshot.tasks[0];
  task.startDate = '2026-09-20T00:00:00+09:00'; task.dueDate = '2026-09-16T00:00:00+09:00';
  render(<SecretaryPanel compact />);
  expect(screen.queryByRole('article', {name:/日程の矛盾/})).not.toBeInTheDocument();
  expect(screen.queryByText(/開始日 .*が期限/)).not.toBeInTheDocument();
  expect(data.act).not.toHaveBeenCalled();
});
