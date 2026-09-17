import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { FeatureRequestDialog } from './FeatureRequestDialog';
const fake = vi.hoisted(() => ({ list: vi.fn(), organize: vi.fn(), register: vi.fn(), upload: vi.fn() }));
vi.mock('@/lib/ai/featureRequest/client', () => ({ requestList: fake.list, organizeFeatureRequest: fake.organize, registerFeatureRequest: fake.register }));
vi.mock('@/stores/aiSettingsStore', () => ({ useAISettingsStore: () => ({ provider: 'gemini', getActiveModel: () => 'test-model' }) }));
vi.mock('@/lib/ai/featureRequest/attachmentUpload', () => ({ uploadRequestAnnotation: fake.upload }));
const draft = { type: 'draft', title: '通知に未読件数を表示', problem: '未読に気づきにくい', desired: '通知ボタンで未読件数を見たい', criteria: ['未読がある場合に件数が見える'], notes: '' };
const projects = [{ id: 'request-project', name: 'タスク管理ツール', isArchived: false }];
function mount(items = projects) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><FeatureRequestDialog open onOpenChange={vi.fn()} userId="owner" projects={items} projectsLoading={false} projectsFailed={false} /></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); fake.list.mockResolvedValue('requests'); fake.organize.mockResolvedValue(draft); fake.register.mockResolvedValue('new-task'); });
async function begin() {
  mount(); await waitFor(() => expect(fake.list).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('textbox', { name: '要望の内容' }), { target: { value: '通知が見づらいです' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'モアイと整理する' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'モアイと整理する' }));
}
it('asks only the AI clarification, keeps the original answer, previews short editable text, and registers only on confirmation', async () => {
  fake.organize.mockResolvedValueOnce({ type: 'questions', summary: '通知を見やすくしたいのですね。', questions: ['どこで気づきにくいですか？'] }).mockResolvedValueOnce(draft);
  await begin(); await screen.findByText('どこで気づきにくいですか？');
  expect(fake.register).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'モアイへの回答' }), { target: { value: '相棒の通知タブです。未読件数がほしいです' } });
  fireEvent.click(screen.getByRole('button', { name: '回答して整理' }));
  const title = await screen.findByRole('textbox', { name: 'タスク名' });
  expect(title).toHaveValue(draft.title); expect(title).toHaveAttribute('maxlength', '32');
  expect((screen.getByRole('textbox', { name: '説明' }) as HTMLTextAreaElement).value).toContain('できたかの確認');
  expect(fake.register).not.toHaveBeenCalled();
  fireEvent.change(title, { target: { value: '通知タブに未読件数を表示' } });
  let finish!: (id: string) => void;
  fake.register.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'この内容で登録' }));
  expect(screen.getByRole('button', { name: '登録中…' })).toBeDisabled();
  expect(fake.register).toHaveBeenCalledOnce();
  expect(fake.register.mock.calls[0]).toEqual(['owner', 'request-project', '通知タブに未読件数を表示', expect.any(String), [
    { role: 'user', content: '通知が見づらいです' }, { role: 'assistant', content: '通知を見やすくしたいのですね。\nどこで気づきにくいですか？' }, { role: 'user', content: '相棒の通知タブです。未読件数がほしいです' },
  ], { id: expect.any(String), annotations: [] }]);
  await act(async () => finish('new-task'));
  expect(screen.getByRole('link', { name: '追加したタスクを開く' })).toHaveAttribute('href', '/projects/request-project/board?task=new-task');
});
it('skips questions for a sufficient request and retains the draft when registration fails', async () => {
  fake.register.mockRejectedValue(new Error('登録を確認できませんでした。'));
  await begin(); await screen.findByRole('textbox', { name: 'タスク名' });
  expect(screen.queryByRole('textbox', { name: 'モアイへの回答' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'この内容で登録' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('textbox', { name: 'タスク名' })).toHaveValue(draft.title);
  expect(screen.queryByText('要望を登録しました。')).not.toBeInTheDocument();
});
it('does not use an unrelated project when the specified destination is unavailable', async () => {
  mount([{ id: 'other', name: '他の案件', isArchived: false }]);
  await screen.findByRole('alert');
  expect(fake.list).not.toHaveBeenCalled(); expect(fake.organize).not.toHaveBeenCalled(); expect(fake.register).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'モアイと整理する' })).toBeDisabled();
});

const capture = { id: '12345678-1234-1234-1234-123456789abc', pageUrl: 'https://taskflow.example/neo', pageTitle: '仕事', target: '通知', comment: '', rect: { x: 10, y: 10, width: 80, height: 80 }, viewport: { width: 100, height: 100 }, capturedAt: '2026-09-13T10:00:00Z', image: new File(['png'], 'annotation.png', { type: 'image/png' }), preview: 'blob:sample' };
vi.mock('./ScreenAnnotationPicker', () => ({ ScreenAnnotationPicker: ({ onCapture, onCancel }: { onCapture: (value: typeof capture) => void; onCancel: () => void }) => <div><button onClick={() => onCapture(capture)}>検証用の場所を選ぶ</button><button onClick={onCancel}>場所の選択を中止</button></div> }));
beforeEach(() => { URL.revokeObjectURL = vi.fn(); });
it('returns from picking with the original input, previews editable annotation, and retries only unfinished images at the same task', async () => {
  mount(); await waitFor(() => expect(fake.list).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('textbox', { name: '要望の内容' }), { target: { value: '通知を見やすくしたい' } });
  fireEvent.click(screen.getByRole('button', { name: '画面に注釈を付ける' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '場所の選択を中止' }));
  expect(screen.getByRole('textbox', { name: '要望の内容' })).toHaveValue('通知を見やすくしたい');
  fireEvent.click(screen.getByRole('button', { name: '画面に注釈を付ける' })); fireEvent.click(screen.getByRole('button', { name: '検証用の場所を選ぶ' }));
  expect(screen.getByRole('img', { name: '画面 1 の注釈画像' })).toHaveAttribute('src', 'blob:sample');
  expect(screen.getByRole('button', { name: 'モアイと整理する' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: '画面 1 へのコメント' }), { target: { value: '未読件数を付けてほしい' } });
  fireEvent.click(screen.getByRole('button', { name: 'モアイと整理する' }));
  await screen.findByRole('textbox', { name: 'タスク名' });
  expect(fake.organize.mock.calls[0][5]).toEqual([expect.objectContaining({ pageUrl: capture.pageUrl, target: capture.target, comment: '未読件数を付けてほしい' })]);
  expect(fake.upload).not.toHaveBeenCalled(); expect(fake.register).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: '画面 1 へのコメント' }), { target: { value: '未読がある時だけ件数を表示して' } });
  fake.upload.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'この内容で登録' }));
  await screen.findByText(/要望は登録済みです。画像 0\/1/);
  expect(fake.register.mock.calls[0][5].annotations[0].comment).toBe('未読がある時だけ件数を表示して');
  expect(screen.getByRole('textbox', { name: 'タスク名' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '残りの画像を再送' }));
  await screen.findByText(/注釈画像 1 件も送信しました/);
  expect(fake.register).toHaveBeenCalledOnce(); expect(fake.upload).toHaveBeenCalledTimes(2);
  expect(fake.upload.mock.calls[0][2]).toBe('new-task'); expect(fake.upload.mock.calls[1][2]).toBe('new-task');
});
it('retains the idempotency key and unchanged content after a lost registration response', async () => {
  fake.register.mockRejectedValueOnce(new Error('通信できませんでした')).mockResolvedValueOnce('same-task');
  await begin(); await screen.findByRole('textbox', { name: 'タスク名' });
  fireEvent.click(screen.getByRole('button', { name: 'この内容で登録' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '同じ受付で再送' })); await screen.findByRole('link', { name: '追加したタスクを開く' });
  expect(fake.register.mock.calls[0]).toEqual(fake.register.mock.calls[1]);
});
