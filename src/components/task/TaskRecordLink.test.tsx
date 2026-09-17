import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskRecordLink } from './TaskRecordLink';
import { getTask, getTaskAttachments, getTaskChecklists, getTaskComments } from '@/lib/firebase/firestore';
import { viewTask } from '@/test/taskViewFixtures';
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>false}));
vi.mock('@/lib/firebase/firestore',()=>({getTask:vi.fn(),getTaskAttachments:vi.fn(),getTaskChecklists:vi.fn(),getTaskComments:vi.fn()}));
vi.mock('@/stores/authStore',()=>({useAuthStore:(select:(s:unknown)=>unknown)=>select({user:{id:'viewer'}})}));
vi.mock('./TaskHistoryTimeline',()=>({TaskHistoryTimeline:({comments}:{comments:{id:string;content:string}[]})=><div aria-label="元の経緯">{comments.map(comment=><p key={comment.id}>{comment.content}</p>)}</div>}));
beforeEach(()=>{vi.clearAllMocks();vi.mocked(getTask).mockResolvedValue(viewTask({id:'old',title:'元の仕事',isArchived:true,description:'元の完了条件',mergedIntoTaskId:'kept'}));vi.mocked(getTaskComments).mockResolvedValue([{id:'c',content:'統合前の合意',attachments:[{id:'f',name:'共有資料.pdf',url:'https://example.test/file',type:'application/pdf',size:1}]}] as never);vi.mocked(getTaskAttachments).mockResolvedValue([]);vi.mocked(getTaskChecklists).mockResolvedValue([{id:'list',title:'元の手順',items:[{id:'i',text:'最初の確認',isChecked:true,order:0}]}] as never);});
afterEach(cleanup);
describe('read-only original task records',()=>{
 it('loads original archived content on demand with comments, comment attachments and checklist state',async()=>{render(<TaskRecordLink projectId="project-1" taskId="old" label="統合元を開く" names={{}} record/>);expect(getTask).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'統合元を開く'}));expect(await screen.findByText('元の完了条件')).toBeVisible();expect(screen.getByText('統合前の合意')).toBeVisible();expect(screen.getByRole('link',{name:'共有資料.pdf'})).toHaveAttribute('href','https://example.test/file');expect(screen.getByText('✓ 最初の確認')).toBeVisible();expect(screen.getByRole('link',{name:'統合先の仕事へ戻る'})).toHaveAttribute('href','/projects/project-1/board?task=kept');});
 it('labels unavailable originals and does not read their subcollections',async()=>{vi.mocked(getTask).mockResolvedValue(null);render(<TaskRecordLink projectId="project-1" taskId="deleted" label="元の記録" names={{}} record/>);fireEvent.click(screen.getByRole('button',{name:'元の記録'}));expect(await screen.findByRole('alert')).toHaveTextContent('削除されたか');expect(getTaskComments).not.toHaveBeenCalled();});
 it('keeps a failed comment fetch explicit while displaying the original task content',async()=>{vi.mocked(getTaskComments).mockRejectedValue(new Error('denied'));render(<TaskRecordLink projectId="project-1" taskId="old" label="元の記録" names={{}} record/>);fireEvent.click(screen.getByRole('button',{name:'元の記録'}));expect(await screen.findByRole('alert')).toHaveTextContent('元コメントを取得できません');expect(screen.getByText('元の完了条件')).toBeVisible();});
});
