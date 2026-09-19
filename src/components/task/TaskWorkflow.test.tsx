import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TaskWorkflow } from './TaskWorkflow';
import { sendWorkflow } from '@/lib/task/workflowClient';
import { viewTask } from '@/test/taskViewFixtures';
vi.mock('@/lib/task/workflowClient',()=>({sendWorkflow:vi.fn()}));
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();vi.mocked(sendWorkflow).mockResolvedValue(null);});
const parent=viewTask({id:'p',assigneeIds:['worker']});
const review=viewTask({id:'r',parentTaskId:'p',taskKind:'review_request',assigneeIds:['reviewer']});
it('requires a change note and retains an identical request through failure, reload and retry',async()=>{
 vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('通信切断'));
 const ui=render(<TaskWorkflow task={review} tasks={[parent,review]} userId="reviewer" />); await act(async()=>{});
 expect(sendWorkflow).not.toHaveBeenCalled(); expect(screen.getByRole('button',{name:'修正が必要'})).toBeDisabled();
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'連絡先を修正してください'}});
 fireEvent.click(screen.getByRole('button',{name:'修正が必要'})); await screen.findByRole('alert');
 const sent=vi.mocked(sendWorkflow).mock.calls[0]; expect(sent[2]).toMatchObject({action:'request_changes',note:'連絡先を修正してください'});
 expect(screen.getByRole('textbox')).toBeDisabled(); ui.unmount();
 render(<TaskWorkflow task={{...review,updatedAt:new Date()}} tasks={[parent,review]} userId="reviewer" />);await act(async()=>{});
 fireEvent.click(screen.getByRole('button',{name:'同じ操作を再試行'}));
 await waitFor(()=>expect(sendWorkflow).toHaveBeenLastCalledWith(...sent)); await screen.findByRole('status'); expect(sessionStorage.length).toBe(0);
});
it('does not expose approval to a worker or treat viewing as a response',async()=>{
 render(<TaskWorkflow task={review} tasks={[parent,review]} userId="worker" />);await act(async()=>{});
 expect(screen.queryByRole('button',{name:'確認OK'})).toBeNull();expect(sendWorkflow).not.toHaveBeenCalled();
});

it('shows the approved handoff only for the last required reviewer', async () => {
 const t={...review,review:{round:1,policy:'all' as const,request:'資料を確認',attachments:[],responses:{},requestedAt:'2026-09-13T00:00:00Z',nextTaskId:'next'},assigneeIds:['reviewer','second']};
 const next=viewTask({id:'next',title:'入稿',assigneeIds:['printer']});
 const ui=render(<TaskWorkflow task={t} tasks={[parent,t,next]} userId="reviewer" continuation />); await act(async()=>{});
 expect(screen.getByRole('button',{name:'確認OK'})).toBeVisible();
 expect(screen.queryByRole('button',{name:'確認OK・入稿へ渡す'})).toBeNull();
 ui.rerender(<TaskWorkflow task={{...t,review:{...t.review,responses:{second:{outcome:'approved',note:'',at:'2026-09-13T01:00:00Z'}}}}} tasks={[parent,t,next]} userId="reviewer" continuation />);
 expect(screen.getByRole('button',{name:'確認OK・入稿へ渡す'})).toBeVisible();
});

it('freezes selected resubmission materials across an uncertain save and retry', async () => {
 const file={id:'pdf-v2',name:'修正版.pdf',url:'https://example.test/v2.pdf',type:'application/pdf',size:100};
 const t={...review,review:{round:1,policy:'any' as const,request:'初稿',attachments:[],responses:{reviewer:{outcome:'changes_requested' as const,note:'会場を修正',at:'2026-09-13T00:00:00Z'}},requestedAt:'2026-09-13T00:00:00Z'}};
 vi.mocked(sendWorkflow).mockRejectedValueOnce(new Error('結果不明'));
 render(<TaskWorkflow task={t} tasks={[parent,t]} userId="worker" continuation availableAttachments={[file]} />); await act(async()=>{});
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'会場を修正しました'}});
 fireEvent.click(screen.getByRole('checkbox',{name:'修正版.pdf'}));
 fireEvent.click(screen.getByRole('button',{name:'再確認を依頼'})); await screen.findByRole('alert');
 const sent=vi.mocked(sendWorkflow).mock.calls[0]; expect(sent[2]).toMatchObject({action:'resubmit',attachments:[file],note:'会場を修正しました'});
 expect(screen.getByRole('checkbox',{name:'修正版.pdf'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'同じ操作を再試行'})); await waitFor(()=>expect(sendWorkflow).toHaveBeenLastCalledWith(...sent));
});
