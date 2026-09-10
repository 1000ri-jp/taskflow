import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentComposer } from './CommentComposer';
import { submitTaskComment } from '@/lib/firebase/commentSubmission';
import { uploadCommentAttachment } from '@/lib/firebase/storage';
import { pendingCommentKey } from '@/lib/task/commentSubmission';
vi.mock('@/lib/firebase/commentSubmission', () => ({ submitTaskComment: vi.fn() }));
vi.mock('@/lib/firebase/storage', () => ({ uploadCommentAttachment: vi.fn() }));
const members = { users: [{ id:'a',displayName:'Nao' },{id:'b',displayName:'Kaori'}], isLoading:false, hasError:false, refresh:vi.fn() };
const props = { projectId:'p',taskId:'parent',authorId:'author',authorName:'Kozue',members };
async function show() { const result = render(<CommentComposer {...props} />); await waitFor(() => expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toBeEnabled()); return result; }
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); vi.mocked(submitTaskComment).mockResolvedValue({commentId:'comment',reviewTaskId:null,alreadySubmitted:false}); });
describe('comment composer', () => {
  it('does not send notifications simply by selecting members; normal posts have no recipients', async () => {
    await show();
    expect(screen.queryByRole('button',{name:'メンバーに通知'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox',{name:'メンバーに通知'}));
    fireEvent.click(within(screen.getByRole('group',{name:'通知先（複数可）'})).getByRole('checkbox',{name:'Nao'}));
    expect(submitTaskComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox',{name:'メンバーに通知'}));
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'),{target:{value:'コメント'}});
    fireEvent.click(screen.getByRole('button',{name:'コメントを投稿'}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ content:'コメント',notifyIds:[],review:null })));
    expect(await screen.findByRole('status')).toHaveTextContent('投稿しました');
  });
  it('validates assignments and submits a multi-assignee request with an optional deadline', async () => {
    await show(); fireEvent.click(screen.getByRole('checkbox',{name:'確認依頼'}));
    fireEvent.change(screen.getByRole('textbox',{name:'依頼内容'}),{target:{value:'安全に運べるか確認'}});
    fireEvent.click(screen.getByRole('button',{name:'コメントと確認依頼を投稿'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('担当者');
    expect(submitTaskComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'全員を選択'}));
    fireEvent.change(screen.getByLabelText('確認期限（任意）'),{target:{value:'2026-09-13'}});
    fireEvent.click(screen.getByRole('button',{name:'コメントと確認依頼を投稿'}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledWith(expect.objectContaining({ notifyIds:[],review:{content:'安全に運べるか確認',assigneeIds:['a','b'],dueDate:'2026-09-13'} })));
  });
  it('locks duplicate submits and retains the same operation and uploaded attachment on retry and remount', async () => {
    let reject!: (e:Error)=>void;
    vi.mocked(submitTaskComment).mockImplementationOnce(() => new Promise((_resolve,no) => {reject=no;}));
    vi.mocked(uploadCommentAttachment).mockResolvedValue({id:'file',name:'memo.txt',url:'https://example.test/memo',type:'text/plain',size:3});
    const page = await show();
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'),{target:{value:'確認メモ'}});
    fireEvent.change(screen.getByLabelText('コメントの添付ファイル'),{target:{files:[new File(['abc'],'memo.txt',{type:'text/plain'})]}});
    fireEvent.click(screen.getByRole('button',{name:'コメントを投稿'}));
    await waitFor(() => expect(submitTaskComment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'投稿・共有保存中…'}));
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
    fireEvent.click(screen.getByRole('button',{name:'コメントを投稿'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('添付失敗');
    expect(submitTaskComment).not.toHaveBeenCalled();
    expect(screen.getByText('memo.txt')).toBeInTheDocument();
  });
  it('allows correcting recipients after a definitive uncommitted rejection', async () => {
    await show();
    vi.mocked(submitTaskComment).mockRejectedValueOnce(Object.assign(new Error('参加していない通知先'), {code:'submission-rejected'}));
    fireEvent.change(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）'), {target:{value:'変更せず残す'}});
    fireEvent.click(screen.getByRole('button',{name:'コメントを投稿'}));
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
      fireEvent.click(screen.getByRole('button',{name:'コメントを投稿'}));
      expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
      expect(submitTaskComment).not.toHaveBeenCalled();
      expect(screen.getByPlaceholderText('コメントを書く（画像は貼り付け可能）')).toBeEnabled();
    } finally { storage.mockRestore(); }
  });
});
