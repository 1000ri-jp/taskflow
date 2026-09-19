import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskOrganizer } from './TaskOrganizer';
import { requestOrganization } from '@/lib/task/organizationClient';
import type { OrganizationAnalysis, OrganizationDraft, OrganizationPreview, OrganizationSource } from '@/lib/task/organizationTypes';
vi.mock('@/lib/task/organizationClient', () => ({ requestOrganization: vi.fn() }));
vi.mock('@/stores/aiSettingsStore', () => ({ useAISettingsStore: (select: (value: unknown) => unknown) => select({ provider: 'openai', getActiveModel: () => 'mock-model' }) }));
const mode = vi.hoisted(() => ({ mock: false }));
vi.mock('@/lib/firebase/testMode', () => ({ isE2EMockAuthEnabled: () => mode.mock }));
const source: OrganizationSource = { kind: 'meeting', id: 'meeting', title: '朝会', text: '公開前の確認をする。', occurredAt: null };
const tasks = [{ id: 'a', title: '案内文', description: '元の完了条件' }, { id: 'b', title: '申込手順', description: '元の手順' }, { id: 'c', title: '会場確認' }];
const draft: OrganizationDraft = { kind: 'update', taskIds: ['a'], targetTaskId: 'a', description: '公開前の確認を追加', reason: '同じ案内文への追記', quote: '公開前の確認' };
const basis: OrganizationAnalysis['basis'] = { schema: 1, projectId: 'p', sourceFingerprint: 'source-version', tasks: { a: { taskVersion: 'v1', commentsVersion: 'c1', checklistsVersion: 'l1' } } };
const preview: OrganizationPreview = { id: 'operation', projectId: 'p', kind: 'update', status: 'pending', sourceTitle: '朝会', quote: '公開前の確認', reason: '同じ仕事', createdAt: '2026-09-12', warnings: [], canApply: true, changes: [{ taskId: 'a', title: '案内文', summary: '追記します', before: '元の完了条件', after: '元の完了条件と確認' }] };
const context = { members: [{ id: 'u', displayName: 'こずえ' }, { id: 'v', displayName: '同僚' }], lists: [{ id: 'work', name: '進行中' }] };
const routine = async (body: Record<string, unknown>): Promise<unknown> => {
  if (body.action === 'list') return [];
  if (body.action === 'context') return context;
  if (body.action === 'analyze') return { drafts: [draft], issues: [], basis };
  if (body.action === 'preview') return preview;
  if (body.action === 'apply') return { ...preview, status: 'applied' };
  if (body.action === 'hold') return { ...preview, status: 'held' };
  if (body.action === 'skip') return { ...preview, status: 'skipped' };
  if (body.action === 'source') return source;
  if (body.action === 'undo') return { ...preview, status: 'undone' };
  throw new Error('予期しない操作');
};
const respond = (handler: typeof routine) => vi.mocked(requestOrganization).mockImplementation(body => handler(body) as never);
beforeEach(() => { vi.clearAllMocks(); mode.mock = false; respond(routine); });
afterEach(cleanup);
const open = async () => { fireEvent.click(screen.getByRole('button', { name: '仕事を整理・反映' })); await waitFor(() => expect(screen.getByRole('button', { name: '自分で整理案を指定' })).toBeEnabled()); };
const card = (name = '案内文') => within(screen.getByRole('article', { name: `整理案: ${name}` }));
const analyze = async () => { fireEvent.click(screen.getByRole('button', { name: 'AIで既存の仕事と照合' })); await screen.findByRole('article', { name: '整理案: 案内文' }); await waitFor(() => expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled()); };

describe('TaskOrganizer review to adoption', () => {
  it('keeps editing and evidence collapsed, then preserves named assignees through concrete preview and adoption', async () => {
    render(<TaskOrganizer projectId="p" projectName="展示会" tasks={tasks} source={source} initialDraft={draft} />); await open();
    expect(screen.getByText('対象：展示会')).toBeVisible();
    expect(screen.getByText(/使い分けも、根拠がある場合にモアイが提案理由で説明/)).toBeVisible();
    expect(screen.getByLabelText('追記・新しい仕事の内容（完了条件もここへ）')).not.toBeVisible();
    fireEvent.click(card().getByText('内容を修正する')); fireEvent.click(card().getByText(/^担当：.*（変更）$/)); fireEvent.click(screen.getByLabelText('こずえ'));
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    expect(requestOrganization).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview', draft: expect.objectContaining({ assigneeIds: ['u'] }) }));
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
    fireEvent.click(card().getByRole('button', { name: '採用して反映' })); await screen.findByRole('button', { name: '反映を戻す' });
    expect(requestOrganization).toHaveBeenCalledWith({ action: 'apply', projectId: 'p', id: 'operation' });
    expect(screen.queryByRole('region', { name: '対応する変更案' })).not.toBeInTheDocument();
  });
  it('shows all inherited child assignees, follows an unedited parent change and preserves explicit selections or clearing', async () => {
    const parents=[{...tasks[0],assigneeIds:['u','v']},{...tasks[1],assigneeIds:['v']}];
    const original=structuredClone(parents);
    render(<TaskOrganizer projectId="p" tasks={parents} source={source} initialDraft={{...draft,kind:'create',title:'発送の準備'}} />);await open();
    const row=card('発送の準備');fireEvent.click(row.getByText('内容を修正する'));fireEvent.click(row.getByText(/^担当：.*（変更）$/));
    expect(row.getByLabelText('こずえ')).toBeChecked();expect(row.getByLabelText('同僚')).toBeChecked();
    fireEvent.change(row.getByLabelText('反映先・親（新規なら任意）'),{target:{value:'b'}});
    expect(row.getByLabelText('こずえ')).not.toBeChecked();expect(row.getByLabelText('同僚')).toBeChecked();
    fireEvent.change(row.getByLabelText('反映先・親（新規なら任意）'),{target:{value:''}});
    expect(row.getByLabelText('こずえ')).not.toBeChecked();expect(row.getByLabelText('同僚')).not.toBeChecked();
    fireEvent.change(row.getByLabelText('反映先・親（新規なら任意）'),{target:{value:'b'}});
    fireEvent.click(row.getByLabelText('同僚'));fireEvent.click(row.getByLabelText('こずえ'));
    fireEvent.change(row.getByLabelText('反映先・親（新規なら任意）'),{target:{value:'a'}});
    expect(row.getByLabelText('こずえ')).toBeChecked();expect(row.getByLabelText('同僚')).not.toBeChecked();
    fireEvent.click(row.getByLabelText('こずえ'));
    fireEvent.click(row.getByRole('button',{name:'変更後の姿を確認'}));
    await waitFor(()=>expect(requestOrganization).toHaveBeenCalledWith(expect.objectContaining({action:'preview',draft:expect.objectContaining({assigneeIds:[]})})));
    expect(parents).toEqual(original);
  });
  it.each([
    { kind: 'update' as const, field: 'assigneeIds', before: ['u'], after: ['v'], expected: 'こずえ → 同僚' },
    { kind: 'complete' as const, field: 'isCompleted', before: false, after: true, expected: '未完了 → 完了' },
  ])('keeps the server $field before/after after live task props update', async ({ kind, field, before, after, expected }) => {
    const proposal = { ...draft, kind };
    const checked: OrganizationPreview = { ...preview, kind, changes: [{ ...preview.changes[0], fields: [{ field, before, after }, { field: 'dueDate', before: null, after: null }, { field: 'durationDays', before: 1, after: 2 }, { field: 'isArchived', before: false, after: false }] }] };
    respond(async body => body.action === 'preview' ? checked : body.action === 'apply' ? { ...checked, status: 'applied' } : routine(body));
    const { rerender } = render(<TaskOrganizer projectId="p" tasks={[{ ...tasks[0], assigneeIds: ['u'], isCompleted: false }]} source={source} initialDraft={proposal} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    fireEvent.click(card().getByRole('button', { name: '採用して反映' })); await screen.findByRole('button', { name: '反映を戻す' });
    rerender(<TaskOrganizer projectId="p" tasks={[{ ...tasks[0], assigneeIds: ['v'], isCompleted: true }]} source={source} initialDraft={proposal} />);
    const concise = card().getAllByRole('definition').filter(element => !element.closest('details'));
    expect(concise).toHaveLength(1); expect(concise[0]).toHaveTextContent(expected);
    expect(card().getByText('必要日数')).not.toBeVisible();
    fireEvent.click(card().getByText('変更前 → 変更後'));
    expect(card().getByText('必要日数')).toBeVisible();
    expect(card().getByRole('link', { name: 'タスクを開く: 案内文' })).toHaveAttribute('href', '/projects/p/board?task=a');
  });
  it('keeps a new task compact while retaining every server field under details', async () => {
    const proposal: OrganizationDraft = { ...draft, kind: 'create', taskIds: [], targetTaskId: undefined, title: '新しい仕事', description: '新しい内容', assigneeIds: ['u'] };
    const fields = [
      { field: 'title', before: null, after: '新しい仕事' }, { field: 'description', before: null, after: '新しい内容' }, { field: 'assigneeIds', before: null, after: ['u'] },
      { field: 'dueDate', before: null, after: null }, { field: 'isCompleted', before: null, after: false }, { field: 'isArchived', before: null, after: false }, { field: 'isDueDateFixed', before: null, after: false },
    ];
    respond(async body => body.action === 'preview' ? { ...preview, kind: 'create', changes: [{ ...preview.changes[0], title: '新しい仕事', before: '', fields }] } : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={proposal} />); await open();
    fireEvent.click(card('新しい仕事').getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    const concise = card('新しい仕事').getAllByRole('term').filter(element => !element.closest('details'));
    expect(concise.map(element => element.textContent)).toEqual(['名前', '説明', '担当']);
    expect(card('新しい仕事').getByText('期限固定')).not.toBeVisible();
    fireEvent.click(card('新しい仕事').getByText('変更前 → 変更後'));
    expect(card('新しい仕事').getByText('期限固定')).toBeVisible();
  });
  it('keeps a before snapshot for older previews and labels every applied task link', async () => {
    const proposal = { ...draft, assigneeIds: ['v'] };
    const checked = { ...preview, changes: [preview.changes[0], { ...preview.changes[0], taskId: 'b', title: '申込手順' }] };
    respond(async body => body.action === 'preview' ? checked : body.action === 'apply' ? { ...checked, status: 'applied' } : routine(body));
    const { rerender } = render(<TaskOrganizer projectId="p" tasks={[{ ...tasks[0], assigneeIds: ['u'] }, tasks[1]]} source={source} initialDraft={proposal} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findAllByText(/追記します/);
    expect(card().queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(card().getByRole('button', { name: '採用して反映' })); await screen.findByRole('button', { name: '反映を戻す' });
    rerender(<TaskOrganizer projectId="p" tasks={[{ ...tasks[0], assigneeIds: ['v'], description: '反映後の内容' }, tasks[1]]} source={source} initialDraft={proposal} />);
    expect(card().getAllByRole('definition').find(element => element.textContent?.includes('こずえ'))).toHaveTextContent('こずえ → から同僚');
    const links = within(card().getByRole('navigation', { name: '反映したタスク' })).getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('タスクを開く：案内文');
    expect(links[0]).toHaveAttribute('href', '/projects/p/board?task=a');
    expect(links[1]).toHaveTextContent('タスクを開く：申込手順');
    expect(links[1]).toHaveAttribute('href', '/projects/p/board?task=b');
  });
  it('keeps incoming text private and allows only the existing manual sharing flow', async () => {
    render(<TaskOrganizer projectId="p" tasks={tasks} source={{ ...source, kind: 'incoming', id: 'gmail:m1', text: '秘密のメール本文' }} initialDraft={{ ...draft, description: '' }} />); await open();
    expect(screen.getByLabelText('追記・新しい仕事の内容（完了条件もここへ）')).toHaveValue('');
    expect(screen.getByText(/元の連絡は本人用/)).toBeVisible(); expect(screen.queryByText('秘密のメール本文')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AIで既存の仕事と照合' })).not.toBeInTheDocument();
    expect(vi.mocked(requestOrganization).mock.calls.every(([body]) => ['list', 'context'].includes(String(body.action)))).toBe(true);
  });
  it('carries analysis basis and confirmed corrections only after the person checks the confirmation', async () => {
    respond(async body => body.action === 'analyze' ? { drafts: [{ ...draft, speech: 'tentative', confirmationPoints: ['公開すると決定したか'] }], issues: [], basis }
      : body.action === 'preview' ? { ...preview, canApply: body.confirmed === true, clarifications: ['公開すると決定したか'] } : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} />); await open(); await analyze();
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    expect(requestOrganization).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview', basis }));
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
    fireEvent.click(card().getByLabelText('確認事項を確認し、必要な修正を済ませました'));
    await waitFor(() => expect(card().getByRole('button', { name: '採用して反映' })).toBeEnabled());
    fireEvent.click(card().getByRole('button', { name: '採用して反映' })); await screen.findByRole('button', { name: '反映を戻す' });
    expect(requestOrganization).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview', confirmed: true, basis }));
  });
  it('keeps a server completion blocker effective even after an explicit confirmation', async () => {
    respond(async body => body.action === 'preview' ? { ...preview, canApply: false, clarifications: ['子の仕事が未完了です。'] } : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={{ ...draft, kind: 'complete' }} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText('子の仕事が未完了です。');
    fireEvent.click(card().getByLabelText('確認事項を確認し、必要な修正を済ませました'));
    fireEvent.click(card().getByRole('button', { name: '採用して反映' }));
    await waitFor(() => expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled());
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it('applies the reviewed previews in order, retains failures, continues other proposals and locks double submission', async () => {
    const calls: string[] = [];
    respond(async body => {
      if (body.action === 'analyze') return { drafts: tasks.map(task => ({ ...draft, targetTaskId: task.id, taskIds: [task.id] })), issues: [], basis };
      if (body.action === 'preview') { const id = (body.draft as OrganizationDraft).targetTaskId!; calls.push(`preview:${id}`); return { ...preview, id, changes: [{ ...preview.changes[0], taskId: id, title: tasks.find(task => task.id === id)!.title }] }; }
      if (body.action === 'apply') { calls.push(`apply:${body.id}`); if (body.id === 'b') throw Object.assign(new Error('仕事が更新されました。再照合してください。'), { status: 409 }); return { ...preview, id: body.id, status: 'applied' }; }
      return routine(body);
    });
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} />); await open(); await analyze();
    calls.length = 0;
    for (const task of tasks) fireEvent.click(screen.getByLabelText(`${task.title}を選択`));
    const button = screen.getByRole('button', { name: '選択済みを反映（3件）' }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(calls).toEqual(['apply:a', 'apply:b', 'apply:c']));
    expect(await screen.findByRole('alert')).toHaveTextContent('再照合');
    expect(within(screen.getByRole('region', { name: '案ごとの結果' })).getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled();
  });
  it.each(['資料の名前', '会議日時（不明なら空欄・日本時間）', '文字起こし・メモ'])('invalidates all old drafts and preview after changing %s', async label => {
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={draft} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    fireEvent.change(screen.getByLabelText(label), { target: { value: label.startsWith('会議日時') ? '2026-09-14T10:30' : '変更した資料' } });
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(label), { target: { value: label.startsWith('会議日時') ? '' : label === '資料の名前' ? source.title : source.text } });
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it('requires a fresh visible preview after editing an analyzed proposal', async () => {
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} />); await open(); await analyze();
    expect(card().getByRole('button', { name: '採用して反映' })).toBeEnabled();
    fireEvent.click(card().getByText('内容を修正する'));
    fireEvent.change(card().getByLabelText('追記・新しい仕事の内容（完了条件もここへ）'), { target: { value: '確認範囲を訂正した内容' } });
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(card().getByLabelText('案内文を選択')).toBeDisabled();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' }));
    await waitFor(() => expect(card().getByRole('button', { name: '採用して反映' })).toBeEnabled());
    expect(requestOrganization).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'preview', basis, draft: expect.objectContaining({ description: '確認範囲を訂正した内容' }) }));
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it('keeps successful automatic previews visible when another proposal cannot be checked', async () => {
    respond(async body => body.action === 'analyze' ? { drafts: [draft, { ...draft, taskIds: ['b'], targetTaskId: 'b' }], issues: ['備品の追加は既に反映されています。'], basis }
      : body.action === 'preview' && (body.draft as OrganizationDraft).targetTaskId === 'b' ? Promise.reject(new Error('申込手順を取得できません。')) : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} />); await open(); await analyze();
    expect(card().getByRole('button', { name: '採用して反映' })).toBeEnabled();
    expect(card('申込手順').getByRole('alert')).toHaveTextContent('申込手順を取得できません。');
    expect(card('申込手順').getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it.each(['個別', '選択済み'])('%s adoption preserves the reviewed manual preview when another person edits the task', async method => {
    let previewReads = 0;
    respond(async body => {
      if (body.action === 'preview') { previewReads += 1; return preview; }
      if (body.action === 'apply') throw Object.assign(new Error('確認後に他の人が仕事を更新しました。'), { status: 409 });
      return routine(body);
    });
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={{ ...draft, descriptionMode: 'replace' }} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' })); await screen.findByText(/追記します/);
    if (method === '選択済み') { fireEvent.click(card().getByLabelText('案内文を選択')); fireEvent.click(screen.getByRole('button', { name: '選択済みを反映（1件）' })); }
    else fireEvent.click(card().getByRole('button', { name: '採用して反映' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('他の人が仕事を更新');
    expect(previewReads).toBe(1);
    expect(requestOrganization).toHaveBeenCalledWith({ action: 'apply', projectId: 'p', id: 'operation' });
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled();
  });
  it('does not apply an in-flight preview after a parent project/source change', async () => {
    let finish!: (value: OrganizationPreview) => void;
    respond(body => body.action === 'preview' ? new Promise<OrganizationPreview>(resolve => { finish = resolve; }) : routine(body));
    const { rerender } = render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={draft} />); await open();
    fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' }));
    rerender(<TaskOrganizer projectId="other" tasks={tasks} source={{ ...source, text: '別のプロジェクトの資料' }} />);
    await act(async () => finish(preview));
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it.each([['見送る', 'skip', '見送り'], ['提案を保留', 'hold', '提案を保留']] as const)('records %s without applying shared task changes', async (label, action, result) => {
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={draft} />); await open(); fireEvent.click(card().getByRole('button', { name: label }));
    await waitFor(() => expect(requestOrganization).toHaveBeenCalledWith({ action, projectId: 'p', id: 'operation' }));
    expect(card().getByText(new RegExp(`· ${result}`))).toBeVisible();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it('keeps already applied and unchanged proposals out of the actionable list', async () => {
    respond(async body => body.action === 'preview' ? { ...preview, status: 'applied' } : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={draft} />); await open(); fireEvent.click(card().getByRole('button', { name: '変更後の姿を確認' }));
    await screen.findByRole('button', { name: '反映を戻す' });
    expect(screen.queryByRole('region', { name: '対応する変更案' })).not.toBeInTheDocument();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
  });
  it('loads a txt/md document and mock example only on explicit request and preserves the meeting date', async () => {
    mode.mock = true;
    respond(async body => body.action === 'example' ? { ...source, title: '架空の会議', text: '会議の例', occurredAt: '2026-09-14T01:30:00.000Z' } : routine(body));
    render(<TaskOrganizer projectId="p" tasks={tasks} source={source} initialDraft={draft} />); await open();
    expect(requestOrganization).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'example' }));
    fireEvent.click(screen.getByRole('button', { name: '会議の例を入れる' }));
    await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toHaveValue('会議の例'));
    expect(screen.getByLabelText('会議日時（不明なら空欄・日本時間）')).toHaveValue('2026-09-14T10:30');
    fireEvent.change(screen.getByLabelText('テキストファイルを読み込む'), { target: { files: [{ name: '記録.md', size: 20, text: async () => '# 次の会議' }] } });
    await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toHaveValue('# 次の会議'));
    expect(screen.getByLabelText('資料の名前')).toHaveValue('記録.md');
    expect(screen.getByLabelText('会議日時（不明なら空欄・日本時間）')).toHaveValue('2026-09-14T10:30');
    expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
  });
});

const projects = [{ id: 'p', name: '展示会' }, { id: 'q', name: '動画制作' }];
const multiTasks = [{ ...tasks[0], projectId: 'p', assigneeIds: ['u'] }, { ...tasks[0], projectId: 'q', title: '動画の進捗', description: '動画の既存説明', assigneeIds: ['q-owner'] }];
const multiBases = { p: basis!, q: { ...basis!, projectId: 'q' } };
const multiDrafts = [
  { projectId: 'p', draft },
  { projectId: 'q', draft: { ...draft, description: '撮影完了を追記', assigneeIds: ['q-owner'] } },
];
const multiPreview = (projectId: string, status: OrganizationPreview['status'] = 'pending'): OrganizationPreview => ({ ...preview, projectId, status,
  changes: [{ ...preview.changes[0], title: projectId === 'p' ? '案内文' : '動画の進捗', fields: [{ field: 'description', before: projectId === 'p' ? '元の完了条件' : '動画の既存説明', after: '進捗を追記' }] }] });
const multiRoutine = async (body: Record<string, unknown>): Promise<unknown> => {
  const projectId = String(body.projectId);
  if (body.action === 'analyze_many') return { proposals: multiDrafts, bases: multiBases, issues: [] };
  if (body.action === 'context') return projectId === 'p' ? context : { members: [{ id: 'q-owner', displayName: '動画担当' }], lists: [{ id: 'q-list', name: '撮影' }] };
  if (body.action === 'preview') return multiPreview(projectId);
  const statuses = { apply: 'applied', hold: 'held', skip: 'skipped', undo: 'undone', reopen: 'pending' } as const;
  if (String(body.action) in statuses) return multiPreview(projectId, statuses[body.action as keyof typeof statuses]);
  return routine(body);
};
const analyzeMulti = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'AIで既存の仕事と照合' }));
  await screen.findByRole('article', { name: '整理案: 案内文' });
  await waitFor(() => expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled());
};

describe('TaskOrganizer cross-project meeting proposals', () => {
  it('routes one memo through distinct project bases and task contexts even when task/operation IDs collide', async () => {
    respond(multiRoutine);
    render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open(); await analyzeMulti();
    expect(screen.getByText('対象：AIがプロジェクトを仕分け')).toBeVisible();
    expect(requestOrganization).toHaveBeenCalledWith({ action: 'analyze_many', projectIds: ['p', 'q'], source, provider: 'openai', model: 'mock-model' });
    for (const project of projects) expect(requestOrganization).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview', projectId: project.id, basis: multiBases[project.id as 'p' | 'q'] }));
    expect(card().getAllByRole('definition').some(element => element.textContent?.includes('元の完了条件'))).toBe(true);
    expect(card('動画の進捗').getAllByRole('definition').some(element => element.textContent?.includes('動画の既存説明'))).toBe(true);
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'apply')).toBe(false);
    fireEvent.click(card().getByLabelText('案内文を選択')); fireEvent.click(card('動画の進捗').getByLabelText('動画の進捗を選択'));
    fireEvent.click(screen.getByRole('button', { name: '選択済みを反映（2件）' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '反映を戻す' })).toHaveLength(2));
    expect(vi.mocked(requestOrganization).mock.calls.filter(([body]) => body.action === 'apply').map(([body]) => body)).toEqual([
      { action: 'apply', projectId: 'p', id: 'operation' }, { action: 'apply', projectId: 'q', id: 'operation' },
    ]);
    expect(card('動画の進捗').getByRole('link', { name: 'タスクを開く: 動画の進捗' })).toHaveAttribute('href', '/projects/q/board?task=a');
    fireEvent.click(screen.getByText('採用・保留の記録（2件）'));
    fireEvent.click(screen.getByRole('button', { name: /動画制作 · 反映済み/ }));
    const history = within(screen.getByRole('region', { name: '保存済みの整理記録' }));
    fireEvent.click(history.getByRole('button', { name: '元の資料を開く' }));
    await waitFor(() => expect(requestOrganization).toHaveBeenCalledWith({ action: 'source', projectId: 'q', id: 'operation' }));
    await waitFor(() => expect(history.getByRole('button', { name: '反映を戻す' })).toBeEnabled());
    fireEvent.click(history.getByRole('button', { name: '反映を戻す' }));
    await waitFor(() => expect(requestOrganization).toHaveBeenCalledWith({ action: 'undo', projectId: 'q', id: 'operation' }));
    expect(card().getByText(/· 反映済み/)).toBeVisible();
    await waitFor(() => expect(card('動画の進捗').getByText(/· 取消済み/)).toBeVisible());
  });
  it('clears foreign references, selection and confirmation when the person corrects the destination project', async () => {
    const proposal = { ...draft, title: '追加する仕事', kind: 'create' as const, taskIds: ['a'], targetTaskId: 'a', listId: 'work', assigneeIds: ['u'], confirmationPoints: ['登録先を確認'] };
    respond(async body => body.action === 'analyze_many' ? { proposals: [{ projectId: 'p', draft: proposal }], bases: multiBases, issues: [] }
      : body.action === 'preview' ? { ...multiPreview(String(body.projectId)), canApply: body.confirmed === true } : multiRoutine(body));
    render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'AIで既存の仕事と照合' })); await screen.findByRole('article', { name: '整理案: 追加する仕事' });
    await waitFor(() => expect(screen.getByRole('button', { name: '再照合' })).toBeEnabled());
    fireEvent.click(card('追加する仕事').getByLabelText('確認事項を確認し、必要な修正を済ませました'));
    await waitFor(() => expect(card('追加する仕事').getByLabelText('追加する仕事を選択')).toBeEnabled());
    fireEvent.click(card('追加する仕事').getByLabelText('追加する仕事を選択'));
    fireEvent.change(card('追加する仕事').getByLabelText('反映先プロジェクト'), { target: { value: 'q' } });
    expect(card('追加する仕事').getByLabelText('追加する仕事を選択')).not.toBeChecked();
    expect(card('追加する仕事').getByLabelText('確認事項を確認し、必要な修正を済ませました')).not.toBeChecked();
    expect(card('追加する仕事').getByRole('button', { name: '採用して反映' })).toBeDisabled();
    fireEvent.click(card('追加する仕事').getByText('内容を修正する'));
    const selector = card('追加する仕事').getByLabelText('反映先・親（新規なら任意）');
    expect(selector).toHaveValue(''); expect(within(selector).queryByRole('option', { name: '案内文' })).not.toBeInTheDocument();
    expect(within(selector).getByRole('option', { name: '動画の進捗' })).toBeInTheDocument();
    expect(card('追加する仕事').getByLabelText('登録先の列')).toHaveValue('');
    fireEvent.click(card('追加する仕事').getByText(/^担当：.*（変更）$/));
    expect(card('追加する仕事').queryByLabelText('こずえ')).not.toBeInTheDocument();
    expect(card('追加する仕事').getByLabelText('動画担当')).not.toBeChecked();
    fireEvent.click(card('追加する仕事').getByRole('button', { name: '変更後の姿を確認' }));
    await waitFor(() => expect(requestOrganization).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'preview', projectId: 'q', basis: multiBases.q })));
    const sent = vi.mocked(requestOrganization).mock.calls.at(-1)![0];
    expect(sent.draft).toMatchObject({ taskIds: [], title: '追加する仕事' });
    for (const field of ['targetTaskId', 'assigneeIds', 'listId']) expect(sent.draft).not.toHaveProperty(field);
    expect(sent).not.toHaveProperty('confirmed');
  });
  it('derives child defaults only from the newly selected project when parent IDs match', async () => {
    const proposal={...draft,kind:'create' as const,title:'新しいサブタスク'};
    respond(async body=>body.action==='analyze_many'?{proposals:[{projectId:'p',draft:proposal}],bases:multiBases,issues:[]}:multiRoutine(body));
    render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />);await open();
    fireEvent.click(screen.getByRole('button',{name:'AIで既存の仕事と照合'}));await screen.findByRole('article',{name:'整理案: 新しいサブタスク'});
    await waitFor(()=>expect(screen.getByRole('button',{name:'再照合'})).toBeEnabled());
    let row=card('新しいサブタスク');fireEvent.click(row.getByText('内容を修正する'));fireEvent.click(row.getByText(/^担当：.*（変更）$/));
    expect(row.getByLabelText('こずえ')).toBeChecked();
    fireEvent.change(row.getByLabelText('反映先プロジェクト'),{target:{value:'q'}});
    row=card('新しいサブタスク');fireEvent.click(row.getByText('内容を修正する'));fireEvent.click(row.getByText(/^担当：.*（変更）$/));
    expect(row.getByLabelText('動画担当')).not.toBeChecked();
    fireEvent.change(row.getByLabelText('反映先・親（新規なら任意）'),{target:{value:'a'}});
    expect(row.getByLabelText('動画担当')).toBeChecked();expect(row.queryByLabelText('こずえ')).not.toBeInTheDocument();
    fireEvent.click(row.getByRole('button',{name:'変更後の姿を確認'}));
    await waitFor(()=>expect(requestOrganization).toHaveBeenLastCalledWith(expect.objectContaining({action:'preview',projectId:'q',basis:multiBases.q})));
    expect(vi.mocked(requestOrganization).mock.calls.at(-1)![0].draft).not.toHaveProperty('assigneeIds');
  });
  it('keeps another project actionable during a context failure and retains errors per project', async () => {
    respond(async body => body.action === 'context' && body.projectId === 'q' ? Promise.reject(new Error('権限を確認できません。')) : multiRoutine(body));
    render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open(); await analyzeMulti();
    expect(card().getByRole('button', { name: '採用して反映' })).toBeEnabled();
    expect(card('動画の進捗').getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(screen.getByText('動画制作：権限を確認できません。')).toBeVisible();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'preview' && body.projectId === 'q')).toBe(false);
    fireEvent.click(card().getByLabelText('案内文を選択'));
    fireEvent.click(screen.getByRole('button', { name: '選択済みを反映（1件）' }));
    await screen.findByRole('button', { name: '反映を戻す' });
    expect(vi.mocked(requestOrganization).mock.calls.filter(([body]) => body.action === 'apply').map(([body]) => body.projectId)).toEqual(['p']);
  });
  it('continues the second selected project after a stale conflict in the first', async () => {
    respond(async body => body.action === 'apply' && body.projectId === 'p' ? Promise.reject(Object.assign(new Error('展示会の更新を再照合してください。'), { status: 409 })) : multiRoutine(body));
    render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open(); await analyzeMulti();
    fireEvent.click(card().getByLabelText('案内文を選択')); fireEvent.click(card('動画の進捗').getByLabelText('動画の進捗を選択'));
    fireEvent.click(screen.getByRole('button', { name: '選択済みを反映（2件）' }));
    await screen.findByRole('button', { name: '反映を戻す' });
    expect(card().getByRole('alert')).toHaveTextContent('再照合'); expect(card().getByRole('button', { name: '採用して反映' })).toBeDisabled();
    expect(card('動画の進捗').getByText(/· 反映済み/)).toBeVisible();
  });
  it('drops an in-flight analysis after the permitted project set changes', async () => {
    let finish!: (value: unknown) => void;
    respond(body => body.action === 'analyze_many' ? new Promise(resolve => { finish = resolve; }) : multiRoutine(body));
    const { rerender } = render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'AIで既存の仕事と照合' }));
    rerender(<TaskOrganizer projects={[projects[0]]} tasks={multiTasks} source={source} />);
    await act(async () => finish({ proposals: multiDrafts, bases: multiBases, issues: [] }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => ['preview', 'apply'].includes(String(body.action)))).toBe(false);
  });
  it('uses the multi-project example only after an explicit click and retains it when the same projects/tasks refresh', async () => {
    mode.mock = true; respond(async body => body.action === 'example_many' ? { ...source, text: '両プロジェクトの会議例' } : multiRoutine(body));
    const { rerender } = render(<TaskOrganizer projects={projects} tasks={multiTasks} source={source} />); await open();
    expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'example_many')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '会議の例を入れる' }));
    await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toHaveValue('両プロジェクトの会議例'));
    expect(requestOrganization).toHaveBeenCalledWith({ action: 'example_many', projectIds: ['p', 'q'] });
    rerender(<TaskOrganizer projects={[{ ...projects[1] }, { ...projects[0] }]} tasks={[...multiTasks, { id: 'example', projectId: 'q', title: '例の仕事' }]} source={{ ...source }} />);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByLabelText('文字起こし・メモ')).toHaveValue('両プロジェクトの会議例');
  });
});


it('waits for data when opened externally and refreshes on reopen without losing its memo', async () => {
  const onOpenChange = vi.fn();
  const { rerender } = render(<TaskOrganizer projectId="p" tasks={tasks} source={source} open onOpenChange={onOpenChange} disabled notice={<p role="status">仕事を読み込み中…</p>} />);
  expect(screen.getByRole('dialog')).toHaveTextContent('仕事を読み込み中…');
  expect(screen.getByLabelText('文字起こし・メモ')).toBeDisabled();
  expect(requestOrganization).not.toHaveBeenCalled();
  rerender(<TaskOrganizer projectId="p" tasks={tasks} source={source} open onOpenChange={onOpenChange} />);
  await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toBeEnabled());
  expect(requestOrganization).toHaveBeenCalledWith({ action: 'context', projectId: 'p' });
  expect(requestOrganization).toHaveBeenCalledWith({ action: 'list', projectId: 'p' });
  fireEvent.change(screen.getByLabelText('文字起こし・メモ'), { target: { value: '次の確認事項' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  rerender(<TaskOrganizer projectId="p" tasks={tasks} source={source} open={false} onOpenChange={onOpenChange} />);
  vi.mocked(requestOrganization).mockClear();
  rerender(<TaskOrganizer projectId="p" tasks={tasks} source={source} open onOpenChange={onOpenChange} />);
  expect(screen.getByLabelText('文字起こし・メモ')).toHaveValue('次の確認事項');
  await waitFor(() => expect(screen.getByLabelText('文字起こし・メモ')).toBeEnabled());
  expect(requestOrganization).toHaveBeenCalledTimes(2);
});


it('keeps held decisions in history and reconsiders only on explicit request',async()=>{
 const held={...preview,status:'held' as const};
 const applied={...preview,id:'applied',status:'applied' as const};
 respond(async body=>body.action==='list'?[held,applied]:body.action==='reconsider'?{source,draft,preview:{...preview,changes:[{...preview.changes[0],before:'最新の完了条件'}]}}:routine(body));
 render(<TaskOrganizer projectId="p" tasks={tasks} open initialRecord={held} />);
 await screen.findByText('採用・保留の記録（2件）');
 expect(screen.queryByRole('region',{name:'反映前の整理案'})).not.toBeInTheDocument();
 expect(screen.queryByRole('region',{name:'メモから反映した仕事'})).not.toBeInTheDocument();
 expect(vi.mocked(requestOrganization).mock.calls.some(([body])=>body.action==='reconsider')).toBe(false);
 const button=screen.getByRole('button',{name:'最新の仕事と照合し直す'});
 await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
 const row=await screen.findByRole('article',{name:'整理案: 案内文'});
 fireEvent.click(within(row).getByText('変更前 → 変更後'));
 expect(within(row).getByText('最新の完了条件')).toBeVisible();
 fireEvent.click(within(row).getByText('内容を修正する'));
 expect(screen.getByLabelText('追記・新しい仕事の内容（完了条件もここへ）')).toHaveValue(draft.description);
 expect(requestOrganization).toHaveBeenCalledWith({action:'reconsider',projectId:'p',id:held.id});
 expect(vi.mocked(requestOrganization).mock.calls.some(([body])=>body.action==='apply')).toBe(false);
 expect(screen.getByRole('button',{name:'選択済みを反映（0件）'})).toBeDisabled();
});
it('keeps a saved proposal visible when reconsideration fails',async()=>{
 const held={...preview,status:'held' as const};
 respond(async body=>{if(body.action==='list')return [held];if(body.action==='reconsider')throw new Error('取得できません');return routine(body);});
 render(<TaskOrganizer projectId="p" tasks={tasks} open initialRecord={held} />);
 const button=screen.getByRole('button',{name:'最新の仕事と照合し直す'});
 await waitFor(()=>expect(button).toBeEnabled());fireEvent.click(button);
 expect(await screen.findByRole('alert')).toHaveTextContent('取得できません');
 expect(screen.getByRole('region',{name:'保存済みの整理記録'})).toBeVisible();
 expect(screen.queryByRole('article')).not.toBeInTheDocument();
});
