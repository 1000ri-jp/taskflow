import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentComposer } from './CommentComposer';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { uploadCommentAttachment } from '@/lib/firebase/storage';
import { frequentRecipientIds } from '@/lib/comments/frequentRecipients';
import { pendingCommentKey, type CommentSubmission } from '@/lib/task/commentSubmission';
vi.mock('@/lib/firebase/commentSubmission', () => ({ submitTaskComment: vi.fn() }));
vi.mock('@/lib/firebase/storage', () => ({ uploadCommentAttachment: vi.fn() }));
const members = { users: [{ id:'a',displayName:'Nao' },{id:'b',displayName:'Kaori'}], isLoading:false, hasError:false, refresh:vi.fn() };
const props = { projectId:'p',taskId:'parent',authorId:'author',authorName:'Kozue',members };
async function show(parentAssigneeIds?: string[]) { const result = render(<CommentComposer {...props} parentAssigneeIds={parentAssigneeIds} />); await waitFor(() => expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toBeEnabled()); return result; }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); vi.mocked(submitTaskComment).mockResolvedValue({commentId:'comment',reviewTaskId:null,alreadySubmitted:false}); });
describe('comment composer', () => {
  it('does not send notifications simply by selecting members; normal posts have no recipients', async () => {
    await show();
    expect(screen.getByRole('radio', { name: 'コメント' })).toBeChecked();
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('通知なし');
    expect(screen.queryByRole('button',{name:'通知先を選ぶ'})).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group',{name:'通知先（複数可）'})).getByRole('checkbox',{name:'Nao'}));
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('Nao（1人）');
    expect(submitTaskComment).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('group',{name:'通知先（複数可）'})).getByRole('checkbox',{name:'Nao'}));
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'),{target:{value:'コメント'}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ content:'コメント',purpose:'memo',notifyIds:[],review:null })));
    expect(await screen.findByRole('status')).toHaveTextContent('投稿しました');
  });
  it('updates frequent recipients only after success, excluding the author from notification choices', async () => {
    let resolve!: (value: { commentId: string; reviewTaskId: null; alreadySubmitted: false }) => void;
    vi.mocked(submitTaskComment).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(<CommentComposer {...props} members={{ ...members, users: [...members.users, { id: 'author', displayName: 'Kozue' }] }} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'メモ・報告の本文' })).toBeEnabled());
    expect(screen.queryByRole('checkbox', { name: 'Kozue' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nao' }));
    expect(frequentRecipientIds('author', 'p')).toEqual([]);
    expect(submitTaskComment).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'メモ・報告の本文' }), { target: { value: '共有記録' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledOnce());
    expect(frequentRecipientIds('author', 'p')).toEqual([]);
    await act(async () => resolve({ commentId: 'comment', reviewTaskId: null, alreadySubmitted: false }));
    expect(frequentRecipientIds('author', 'p')).toEqual(['a']);
    expect(screen.getByRole('checkbox', { name: 'Nao' })).not.toBeChecked();
  });
  it('validates assignments and submits a multi-assignee request with an optional deadline', async () => {
    await show(); fireEvent.click(screen.getByRole('radio',{name:'確認依頼'}));
    fireEvent.change(screen.getByRole('textbox',{name:'確認してほしいこと'}),{target:{value:'安全に運べるか確認'}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('担当者');
    expect(submitTaskComment).not.toHaveBeenCalled();
    for (const name of ['Nao', 'Kaori']) fireEvent.click(within(screen.getByRole('group', { name: '確認する人（複数可）' })).getByRole('checkbox', { name }));
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('Nao、Kaori（2人）');
    fireEvent.change(screen.getByLabelText('確認期限（任意）'),{target:{value:'2026-09-13'}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ purpose:'review_request',notifyIds:[],review:{content:'安全に運べるか確認',assigneeIds:['a','b'],dueDate:'2026-09-13'} })));
  });
  it('inherits every parent assignee for a review but keeps a normal memo free of inherited notifications', async () => {
    await show(['a', 'b']);
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('通知なし');
    for (const name of ['Nao', 'Kaori']) expect(screen.getByRole('checkbox', { name })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: 'メモ・報告の本文' }), { target: { value: '共有する記録' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ purpose: 'memo', notifyIds: [], review: null })));
    await screen.findByRole('status');
    expect(frequentRecipientIds('author', 'p')).toEqual([]);
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    for (const name of ['Nao', 'Kaori']) expect(reviewers.getByRole('checkbox', { name })).toBeChecked();
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('Nao、Kaori（2人）');
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '親の担当者全員で確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: 'review_request', notifyIds: [], review: { content: '親の担当者全員で確認', assigneeIds: ['a', 'b'], dueDate: null } })));
  });
  it('follows parent assignment updates while the review selection has not been edited', async () => {
    const page = await show();
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('確認する人を選ぶ');
    page.rerender(<CommentComposer {...props} parentAssigneeIds={['a']} />);
    const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    expect(reviewers.getByRole('checkbox', { name: 'Nao' })).toBeChecked();
    page.rerender(<CommentComposer {...props} parentAssigneeIds={['b']} />);
    expect(reviewers.getByRole('checkbox', { name: 'Nao' })).not.toBeChecked();
    expect(reviewers.getByRole('checkbox', { name: 'Kaori' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '最新の担当者へ確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ review: { content: '最新の担当者へ確認', assigneeIds: ['b'], dueDate: null } })));
  });
  it.each([false, true])('preserves manual assignments when parent assignments change, including an explicit empty selection (empty: %s)', async empty => {
    const page = await show(['a', 'b']);
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    fireEvent.click(reviewers.getByRole('checkbox', { name: 'Kaori' }));
    if (empty) fireEvent.click(reviewers.getByRole('checkbox', { name: 'Nao' }));
    page.rerender(<CommentComposer {...props} parentAssigneeIds={['b']} />);
    expect(reviewers.getByRole('checkbox', { name: 'Nao' })).toHaveProperty('checked', !empty);
    expect(reviewers.getByRole('checkbox', { name: 'Kaori' })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '選んだ担当者で確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    if (empty) {
      expect(await screen.findByRole('alert')).toHaveTextContent('担当者');
      expect(submitTaskComment).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ review: { content: '選んだ担当者で確認', assigneeIds: ['a'], dueDate: null } })));
    }
  });
  it('freezes the sent assignees across parent updates and retries, then restores the current parent default after success', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(submitTaskComment).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const page = await show(['a']);
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '送信した担当者で確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledOnce());
    const sent = vi.mocked(submitTaskComment).mock.calls[0][0];
    page.rerender(<CommentComposer {...props} parentAssigneeIds={['b']} />);
    await act(async () => reject(new Error('結果不明')));
    const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    expect(reviewers.getByRole('checkbox', { name: 'Nao' })).toBeChecked();
    expect(reviewers.getByRole('checkbox', { name: 'Kaori' })).not.toBeChecked();
    expect(reviewers.getByRole('checkbox', { name: 'Nao' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '同じ投稿を再試行' }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenLastCalledWith(sent));
    await screen.findByRole('status');
    expect(submitTaskComment).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    const nextReviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    expect(nextReviewers.getByRole('checkbox', { name: 'Nao' })).not.toBeChecked();
    expect(nextReviewers.getByRole('checkbox', { name: 'Kaori' })).toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '次の確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenLastCalledWith(expect.objectContaining({ review: { content: '次の確認', assigneeIds: ['b'], dueDate: null } })));
  });
  it.each([{ projectId: 'p', taskId: 'other-parent' }, { projectId: 'other-project', taskId: 'parent' }])('starts with the destination parent assignees when the caller changes the project/task key (%j)', async scope => {
    const page = render(<CommentComposer key="p:parent" {...props} parentAssigneeIds={['a']} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: '確認依頼' })).toBeEnabled());
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    const reviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    fireEvent.click(reviewers.getByRole('checkbox', { name: 'Nao' }));
    fireEvent.click(reviewers.getByRole('checkbox', { name: 'Kaori' }));
    page.rerender(<CommentComposer key={`${scope.projectId}:${scope.taskId}`} {...props} {...scope} parentAssigneeIds={['a']} />);
    await waitFor(() => expect(screen.getByRole('radio', { name: '確認依頼' })).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'コメント' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    const destinationReviewers = within(screen.getByRole('group', { name: '確認する人（複数可）' }));
    expect(destinationReviewers.getByRole('checkbox', { name: 'Nao' })).toBeChecked();
    expect(destinationReviewers.getByRole('checkbox', { name: 'Kaori' })).not.toBeChecked();
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '移動先で確認' } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...scope, review: { content: '移動先で確認', assigneeIds: ['a'], dueDate: null } })));
  });
  it('previews the union of review and additional recipients without creating duplicate notifications', async () => {
    await show();
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: '数量の確認' } });
    fireEvent.click(within(screen.getByRole('group', { name: '確認する人（複数可）' })).getByRole('checkbox', { name: 'Nao' }));
    fireEvent.click(screen.getByText('補足・追加の通知先・確認後の仕事（任意）'));
    for (const name of ['Nao', 'Kaori']) fireEvent.click(within(screen.getByRole('group', { name: '追加の通知先（複数可）' })).getByRole('checkbox', { name }));
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('通知：Nao、Kaori（2人）');
    expect(submitTaskComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'review_request', notifyIds: ['a', 'b'], review: { content: '数量の確認', assigneeIds: ['a'], dueDate: null } })));
  });
  it('keeps both drafts when switching purpose but excludes hidden review recipients from a memo', async () => {
    await show();
    fireEvent.change(screen.getByRole('textbox', { name: 'メモ・報告の本文' }), { target: { value: '共有する記録' } });
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    fireEvent.change(screen.getByRole('textbox', { name: '確認してほしいこと' }), { target: { value: 'あとで依頼する' } });
    for (const name of ['Nao', 'Kaori']) fireEvent.click(within(screen.getByRole('group', { name: '確認する人（複数可）' })).getByRole('checkbox', { name }));
    fireEvent.click(screen.getByRole('radio', { name: 'コメント' }));
    expect(screen.getByRole('textbox', { name: 'メモ・報告の本文' })).toHaveValue('共有する記録');
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent('通知なし');
    fireEvent.click(screen.getByRole('radio', { name: '確認依頼' }));
    expect(screen.getByRole('textbox', { name: '確認してほしいこと' })).toHaveValue('あとで依頼する');
    fireEvent.click(screen.getByRole('radio', { name: 'コメント' }));
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'memo', content: '共有する記録', notifyIds: [], review: null })));
  });
  it.each([false, true])('restores old pending submissions without adding purpose or changing the retry payload (review: %s)', async review => {
    const saved: CommentSubmission = {
      id: 'legacy-intent', projectId: 'p', taskId: 'parent', authorId: 'author', authorName: 'Kozue',
      content: '以前の投稿', notifyIds: ['b'], attachments: [{ id: 'f', name: '添付.txt', type: 'text/plain', size: 1, url: 'https://example.test/f' }],
      review: review ? { content: '以前の確認依頼', assigneeIds: ['a'], dueDate: '2026-09-15' } : null,
    };
    sessionStorage.setItem(pendingCommentKey('author', 'p', 'parent'), JSON.stringify(saved));
    await act(async () => { render(<CommentComposer {...props} parentAssigneeIds={['b']} />); });
    expect(screen.getByRole('radio', { name: review ? '確認依頼' : 'コメント' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'コメント' })).toBeDisabled();
    expect(screen.getByLabelText('投稿内容と通知先')).toHaveTextContent(review ? 'Nao、Kaori（2人）' : 'Kaori（1人）');
    fireEvent.click(screen.getByRole('button', { name: '同じ投稿を再試行' }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledExactlyOnceWith(saved));
    expect(uploadCommentAttachment).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('radio', { name: 'コメント' })).toBeEnabled());
    expect(screen.getByRole('radio', { name: 'コメント' })).toBeChecked();
  });
  it('accepts attachment-only memos and preserves their purpose and no-notification default', async () => {
    await show();
    const attachment = { id: 'f', name: 'memo.txt', type: 'text/plain', size: 3, url: 'https://example.test/f' };
    vi.mocked(uploadCommentAttachment).mockResolvedValue(attachment);
    fireEvent.change(screen.getByLabelText('コメントの添付ファイル'), { target: { files: [new File(['abc'], 'memo.txt', { type: 'text/plain' })] } });
    fireEvent.click(screen.getByRole('button', { name: /^(投稿|確認を依頼)$/ }));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'memo', content: '', notifyIds: [], review: null, attachments: [attachment] })));
  });
  it('locks duplicate submits and retains the same operation and uploaded attachment on retry and remount', async () => {
    let reject!: (e:Error)=>void;
    vi.mocked(submitTaskComment).mockImplementationOnce(() => new Promise((_resolve,no) => {reject=no;}));
    vi.mocked(uploadCommentAttachment).mockResolvedValue({id:'file',name:'memo.txt',url:'https://example.test/memo',type:'text/plain',size:3});
    const page = await show();
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'),{target:{value:'確認メモ'}});
    fireEvent.change(screen.getByLabelText('コメントの添付ファイル'),{target:{files:[new File(['abc'],'memo.txt',{type:'text/plain'})]}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'投稿中…'}));
    expect(submitTaskComment).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(submitTaskComment).mock.calls[0][0];
    await act(async () => reject(new Error('接続が切れました')));
    expect(await screen.findByRole('alert')).toHaveTextContent('接続が切れました');
    expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toHaveValue('確認メモ');
    page.unmount(); await act(async () => { render(<CommentComposer {...props} />); });
    fireEvent.click(await screen.findByRole('button',{name:'同じ投稿を再試行'}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledTimes(2));
    expect(vi.mocked(submitTaskComment).mock.calls[1][0]).toEqual(sent);
    expect(uploadCommentAttachment).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sessionStorage.getItem(pendingCommentKey('author','p','parent'))).toBeNull());
  });
  it('retains the unsent draft on upload failure and never calls shared registration', async () => {
    await show(); vi.mocked(uploadCommentAttachment).mockRejectedValue(new Error('添付失敗'));
    fireEvent.change(screen.getByLabelText('コメントの添付ファイル'),{target:{files:[new File(['abc'],'memo.txt')]}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('添付失敗');
    expect(submitTaskComment).not.toHaveBeenCalled();
    expect(screen.getByText('memo.txt')).toBeInTheDocument();
  });
  it('allows correcting recipients after a definitive uncommitted rejection', async () => {
    await show();
    vi.mocked(submitTaskComment).mockRejectedValueOnce(Object.assign(new Error('参加していない通知先'), {code:'submission-rejected'}));
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'), {target:{value:'変更せず残す'}});
    fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
    expect(await screen.findByRole('alert')).toHaveTextContent('参加していない');
    expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toBeEnabled();
    expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toHaveValue('変更せず残す');
    expect(sessionStorage.getItem(pendingCommentKey('author','p','parent'))).toBeNull();
  });
  it('does not send when it cannot persist the retry receipt', async () => {
    await show();
    const storage = vi.spyOn(Storage.prototype,'setItem').mockImplementation(() => {throw new Error('保存できません');});
    try {
      fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'), {target:{value:'残す'}});
      fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
      expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
      expect(submitTaskComment).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toBeEnabled();
    } finally { storage.mockRestore(); }
  });
});

it('keeps optional details collapsed and freezes the selected all-reviewer rule', async () => {
  await show(['a','b']);fireEvent.click(screen.getByRole('radio',{name:'確認依頼'}));
  expect(screen.getByText('補足・追加の通知先・確認後の仕事（任意）').closest('details')).not.toHaveAttribute('open');
  fireEvent.change(screen.getByRole('textbox',{name:'確認してほしいこと'}),{target:{value:'2人で最終確認'}});
  fireEvent.change(screen.getByRole('combobox',{name:'確認の完了条件'}),{target:{value:'all'}});
  fireEvent.click(screen.getByRole('button',{name:'確認を依頼'}));
  await waitFor(()=>expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({review:expect.objectContaining({policy:'all',assigneeIds:['a','b']})})));
});


it('summarizes a prepared review, retains explicit recipients, and opens editing only when needed', async () => {
 const {viewTask}=await import('@/test/taskViewFixtures');
 const task=viewTask({id:'parent',projectId:'p',assigneeIds:['author']});
 render(<CommentComposer {...props} tasks={[task]} reviewContext={{request:'金額を確認してください',assigneeIds:['a'],nextTaskId:'',policy:'any',sourceLabel:'前回の依頼を使用',expectedVersion:task.updatedAt.toISOString()}} />);
 await waitFor(()=>expect(screen.getByRole('button',{name:'資料を送って確認を依頼'})).toBeEnabled());
 expect(screen.getByText('金額を確認してください',{selector:'p'})).toBeVisible();
 expect(screen.queryByRole('textbox',{name:'確認してほしいこと'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'内容・相手を変える'}));
 expect(screen.getByRole('textbox',{name:'確認してほしいこと'})).toHaveValue('金額を確認してください');
 fireEvent.click(screen.getByRole('button',{name:'確認表示に戻す'}));
 fireEvent.click(screen.getByRole('button',{name:'資料を送って確認を依頼'}));
 await waitFor(()=>expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({review:expect.objectContaining({assigneeIds:['a'],content:'金額を確認してください'})})));
});

it('sends urgent only when chosen for a review and resets it after success',async()=>{
 await show(['a']);fireEvent.click(screen.getByRole('radio',{name:'確認依頼'}));fireEvent.change(screen.getByRole('textbox',{name:'確認してほしいこと'}),{target:{value:'公開前に確認してください'}});fireEvent.click(screen.getByRole('checkbox',{name:'至急'}));fireEvent.click(screen.getByRole('button',{name:/^(投稿|確認を依頼)$/}));
 await waitFor(()=>expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({review:expect.objectContaining({urgency:'urgent'})})));
 await screen.findByRole('status');fireEvent.click(screen.getByRole('radio',{name:'確認依頼'}));expect(screen.getByRole('checkbox',{name:'至急'})).not.toBeChecked();
});
