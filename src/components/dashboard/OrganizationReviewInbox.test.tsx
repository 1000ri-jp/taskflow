import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OrganizationReviewInbox } from './OrganizationReviewInbox';
import type { OrganizationPreview } from '@/lib/task/organizationTypes';
import { requestOrganization } from '@/lib/task/organizationClient';
const state=vi.hoisted(()=>({records:[] as OrganizationPreview[],failed:false,refresh:vi.fn()}));
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>true}));
vi.mock('@/hooks/useAISettings',()=>({useAISettings:vi.fn()}));
vi.mock('@/hooks/useOrganizationRecords',()=>({useOrganizationRecords:()=>({...state,loading:false})}));
vi.mock('@/lib/task/organizationClient',()=>({requestOrganization:vi.fn()}));
vi.mock('@/components/task/TaskOrganizer',async original=>({
 ...await original<typeof import('@/components/task/TaskOrganizer')>(),
 TaskOrganizer:({projectId,initialRecord,label}:{projectId?:string;initialRecord?:OrganizationPreview;label?:string})=>initialRecord ? <div role="dialog" aria-label={projectId+':'+initialRecord.id}><input aria-label="検討中の編集" /></div> : <button>{label}</button>
}));
const props={userId:'u',projects:[{id:'p',name:'展示会'}],tasks:[]};
beforeEach(()=>{
 vi.clearAllMocks();state.failed=false;
 state.records=['held','pending','applied','skipped'].map((status,index)=>({id:String(index),projectId:'p',aiSuggested:true,kind:'update',status,createdAt:'2026-09-16T01:00:00Z',reason:'印刷会社の回答に合わせて期限を更新します。',quote:'納品は9月20日です',changes:[{taskId:'t',title:'仕事'+index,summary:'期限を変更',fields:[{field:'dueDate',before:'2026-09-18',after:'2026-09-20'}]}],sourceTitle:'会議メモ',warnings:[],canApply:true} as OrganizationPreview));
 vi.mocked(requestOrganization).mockImplementation(async body=>{
  if(body.action==='context')return {members:[],lists:[]};
  const record=state.records.find(record=>record.id===body.id)!;
  return {...record,status:body.action==='apply'?'applied':body.action==='hold'?'held':'skipped'};
 });
});
afterEach(cleanup);
it('shows reason, source and actual changes without opening another screen; adopts once and retires the proposal',async()=>{
 render(<OrganizationReviewInbox {...props} />);
 const card=screen.getByRole('article',{name:'提案: 仕事1'});
 expect(within(card).getByText('印刷会社の回答に合わせて期限を更新します。')).toBeVisible();
 expect(within(card).getByText('2026/9/18')).toBeVisible();
 expect(card).toHaveTextContent('2026/9/20');
 expect(within(card).getByText('納品は9月20日です')).toBeVisible();
  const adopt=within(card).getByRole('button',{name:'採用して反映'});
  expect(screen.queryByText('モアイが照合した変更案です。採用した内容だけを仕事に反映します。')).not.toBeInTheDocument();
 await waitFor(()=>expect(adopt).toBeEnabled());
 fireEvent.click(adopt);fireEvent.click(adopt);
 await screen.findByText('「仕事1」に反映しました。');
 expect(screen.queryByRole('article')).not.toBeInTheDocument();
 expect(vi.mocked(requestOrganization).mock.calls.filter(([body])=>body.action==='apply')).toHaveLength(1);
 const history=screen.getByRole('region',{name:'これまでの判断・記録'});
 const summary=within(history).getByText('これまでの判断・記録（4件）');
 expect(summary.closest('details')).not.toHaveAttribute('open');
 fireEvent.click(summary);
 const items=within(history).getAllByRole('listitem');
 expect(items).toHaveLength(4);
 expect(items[0].querySelector('[data-slot="card"]')).toHaveClass('border');
 const adopted=items.find(item=>item.textContent?.includes('仕事1'))!;
 expect(adopted).toHaveTextContent('モアイのコメント');
 expect(within(adopted).getByRole('link',{name:'反映した仕事を開く'})).toHaveAttribute('href','/projects/p/board?task=t');
});
it.each(['保留','見送る'])('saves %s once and keeps it out of proposals on reopening',async label=>{
 render(<OrganizationReviewInbox {...props} />);
 fireEvent.click(within(screen.getByRole('article')).getByRole('button',{name:label}));
 await waitFor(()=>expect(screen.queryByRole('article')).not.toBeInTheDocument());
 const calls=vi.mocked(requestOrganization).mock.calls.filter(([body])=>body.action!=='context');
 expect(calls).toHaveLength(1);expect(calls[0][0].action).toBe(label==='保留'?'hold':'skip');
 state.records[1]={...state.records[1],status:label==='保留'?'held':'skipped'};
 cleanup();render(<OrganizationReviewInbox {...props} />);
 expect(screen.queryByRole('article')).not.toBeInTheDocument();
 expect(state.records).toHaveLength(4);
});
it('preserves the proposal on a save conflict and opens adjustment without losing it on a failed refresh',async()=>{
 vi.mocked(requestOrganization).mockImplementation(async body=>{if(body.action==='context')return {members:[],lists:[]};throw new Error('確認後に仕事が更新されました');});
 const {rerender}=render(<OrganizationReviewInbox {...props} />);
 const card=screen.getByRole('article');const adopt=within(card).getByRole('button',{name:'採用して反映'});
 await waitFor(()=>expect(adopt).toBeEnabled());fireEvent.click(adopt);
 expect(await screen.findByRole('alert')).toHaveTextContent('確認後に仕事が更新');
 expect(card).toBeVisible();fireEvent.click(within(card).getByRole('button',{name:'内容を調整'}));
 fireEvent.change(screen.getByLabelText('検討中の編集'),{target:{value:'途中の編集'}});
 state.records=[];state.failed=true;rerender(<OrganizationReviewInbox {...props} />);
 expect(screen.getByLabelText('検討中の編集')).toHaveValue('途中の編集');
 rerender(<OrganizationReviewInbox {...props} projects={[]} />);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('never labels a manual or unknown-origin record as an AI proposal and never claims an empty result on failure',()=>{
 state.records=state.records.map(record=>({...record,aiSuggested:undefined}));
 const {rerender}=render(<OrganizationReviewInbox {...props} />);
 expect(screen.queryByRole('article')).not.toBeInTheDocument();
 const history=screen.getByRole('region',{name:'これまでの判断・記録'});
 const summary=within(history).getByText('これまでの判断・記録（4件）');
 expect(summary.closest('details')).not.toHaveAttribute('open');
 fireEvent.click(summary);
 expect(within(history).getAllByRole('listitem')).toHaveLength(4);
 expect(within(history).getAllByRole('listitem')[0].querySelector('[data-slot="card"]')).toHaveClass('border');
 expect(screen.getByRole('heading',{name:'モアイの提案'})).toBeVisible();
 expect(screen.queryByText('新しいメモから、仕事の整理をモアイに頼めます。')).not.toBeInTheDocument();
 state.failed=true;rerender(<OrganizationReviewInbox {...props} />);
 expect(screen.queryByText('いま判断が必要な提案はありません。')).not.toBeInTheDocument();
 expect(screen.getByRole('alert')).toHaveTextContent('取得できません');
});
it('keeps unresolved clarification blocked and renders checklist contents directly',async()=>{
 state.records=[{...state.records[1],kind:'checklist',canApply:false,clarifications:['担当者の返答を確認'],checklist:['画像を入稿する','印刷結果を確認する']}];
 render(<OrganizationReviewInbox {...props} />);
 expect(screen.getByText('画像を入稿する')).toBeVisible();
 expect(screen.getByText('印刷結果を確認する')).toBeVisible();
 expect(screen.getByText('担当者の返答を確認')).toBeVisible();
 expect(screen.getByText('同じ担当が進める細かな手順は、チェックリストにまとめます。')).toBeVisible();
 expect(screen.getByRole('button',{name:'採用して反映'})).toBeDisabled();
});

it('shows the proposed destination by name and omits empty defaults from a new task',async()=>{
 state.records=[{...state.records[1],kind:'create',changes:[{taskId:'new',title:'発送準備',summary:'新規作成',before:'',fields:[{field:'title',before:null,after:'発送準備'},{field:'listId',before:null,after:'work'},{field:'isArchived',before:null,after:false},{field:'isCompleted',before:null,after:false},{field:'dependsOnTaskIds',before:null,after:[]}]}]}];
 vi.mocked(requestOrganization).mockResolvedValue({members:[],lists:[{id:'work',name:'出展準備'}]});
 render(<OrganizationReviewInbox {...props} />);
 const card=screen.getByRole('article',{name:'提案: 発送準備'});
 expect(await within(card).findByText('リスト')).toBeVisible();
 await waitFor(()=>expect(card).toHaveTextContent('出展準備'));
 expect(within(card).queryByText('アーカイブ')).not.toBeInTheDocument();
  expect(within(card).queryByText('前提の仕事')).not.toBeInTheDocument();
});

it('moves through proposal records without deciding and can show the whole round', async () => {
 state.records = [
  { ...state.records[1], id: 'first', status: 'pending', createdAt: '2026-09-16T01:00:00Z', changes: [{ taskId: 'first-task', title: '最初の仕事', summary: '確認', fields: [{ field: 'dueDate', before: null, after: new Date().toISOString().slice(0,10) }] }] },
  { ...state.records[1], id: 'second', status: 'pending', createdAt: '2026-09-16T02:00:00Z', changes: [{ taskId: 'second-task', title: '次の仕事', summary: '確認', fields: [{ field: 'dueDate', before: null, after: '2026-09-18' }] }] },
 ];
 render(<OrganizationReviewInbox {...props} />);
 await waitFor(()=>expect(screen.getAllByRole('article')).toHaveLength(1));
 const navigation = screen.getByLabelText('提案案件の移動');
 expect(navigation).toHaveTextContent('1 / 2件');
 expect(navigation).toHaveTextContent('今日が回答期限');
 const initiallyShown = screen.getByRole('article').getAttribute('aria-label');
 expect(['提案: 最初の仕事', '提案: 次の仕事']).toContain(initiallyShown);
 fireEvent.click(within(navigation).getByRole('button', { name: '次の件' }));
 expect(navigation).toHaveTextContent('2 / 2件');
 const nextShown = screen.getByRole('article').getAttribute('aria-label');
 expect(nextShown).not.toBe(initiallyShown);
 expect(['提案: 最初の仕事', '提案: 次の仕事']).toContain(nextShown);
 fireEvent.click(within(navigation).getByRole('button', { name: 'ほかの件を見る（一覧）' }));
 expect(screen.getAllByRole('article')).toHaveLength(2);
 expect(state.records.every(record => record.status === 'pending')).toBe(true);
});

it('records a user-selected reminder separately from task changes', async () => {
 state.records = [{ ...state.records[1], id: 'reminder', status: 'pending' }];
 render(<OrganizationReviewInbox {...props} />);
 const card = screen.getByRole('article');
 fireEvent.click(within(card).getByRole('button', { name: 'あとで知らせる' }));
 fireEvent.change(within(card).getByLabelText('日時を決めて知らせる'), { target: { value: '2026-09-20T10:00' } });
 fireEvent.click(within(card).getByRole('button', { name: '日時を記録' }));
 await waitFor(() => expect(vi.mocked(requestOrganization).mock.calls.some(([body]) => body.action === 'defer')).toBe(true));
 const call = vi.mocked(requestOrganization).mock.calls.find(([body]) => body.action === 'defer')![0];
 expect(call).toMatchObject({ action: 'defer', followUp: { kind: 'at' } });
 expect(state.records[0].status).toBe('pending');
});
