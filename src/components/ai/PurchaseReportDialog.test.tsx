import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import PurchaseReportDialog from './PurchaseReportDialog';
import {preparePurchase,savePurchase,PurchaseRequestError} from '@/lib/task/purchase/client';
import {uploadCommentAttachment} from '@/lib/firebase/storage';
const owner=vi.hoisted(()=>({id:'u'}));
vi.mock('@/stores/authStore',()=>({useAuthStore:{getState:()=>({user:owner})}}));
vi.mock('@/stores/aiSettingsStore',()=>({useAISettingsStore:()=>({provider:'openai',getActiveModel:()=>undefined})}));
vi.mock('@/lib/firebase/testMode',()=>({isE2EMockAuthEnabled:()=>false}));
vi.mock('@/lib/task/purchase/client',()=>({preparePurchase:vi.fn(),savePurchase:vi.fn(),PurchaseRequestError:class extends Error {constructor(message:string,public rejected:boolean){super(message);}}}));
vi.mock('@/lib/firebase/storage',()=>({uploadCommentAttachment:vi.fn()}));
const prepared={report:{merchant:'ショップ',item:'名刺',orderNumber:'ORDER-1',orderedOn:'2026-09-14',stage:'ordered' as const,expectedDate:null,sourceText:'名刺を注文しました',question:''},candidates:[{key:'p/t',projectId:'p',taskId:'t',title:'名刺発注',projectName:'制作'}],suggested:['p/t']};
const file=new File(['fake'],'purchase.png',{type:'image/png'});
const attachment={id:'image',url:'https://firebasestorage.googleapis.com/v0/b/example/o/projects%2Fp%2Ftasks%2Ft%2Fcomment_attachments%2Fx',name:'purchase.png',type:'image/png',size:4};
beforeEach(()=>{owner.id='u';vi.clearAllMocks();sessionStorage.clear();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:test'),revokeObjectURL:vi.fn()}));vi.mocked(preparePurchase).mockResolvedValue(prepared);vi.mocked(uploadCommentAttachment).mockResolvedValue(attachment);vi.mocked(savePurchase).mockResolvedValue({commentId:'comment',taskId:'t',tracked:true,alreadyApplied:false});});
afterEach(()=>vi.unstubAllGlobals());
async function show(){render(<PurchaseReportDialog open onOpenChange={vi.fn()} userId="u" initialFile={file}/>);fireEvent.click(screen.getByRole('button',{name:'モアイに報告'}));await screen.findByRole('button',{name:'記録して追跡'});}
it('keeps the image after upload failure and retries the same upload before recording',async()=>{
 vi.mocked(uploadCommentAttachment).mockRejectedValueOnce(new Error('upload failed'));await show();
 fireEvent.click(screen.getByRole('button',{name:'記録して追跡'}));expect(await screen.findByRole('alert')).toHaveTextContent('upload failed');expect(savePurchase).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'記録して追跡'}));await waitFor(()=>expect(savePurchase).toHaveBeenCalledOnce());
 expect(vi.mocked(uploadCommentAttachment).mock.calls[1][3]).toBe(vi.mocked(uploadCommentAttachment).mock.calls[0][3]);expect(vi.mocked(savePurchase).mock.calls[0][0].attachment).toEqual(attachment);
});
it('retries an uncertain save with the identical receipt and no second upload',async()=>{
 vi.mocked(savePurchase).mockRejectedValueOnce(new Error('connection lost'));await show();fireEvent.click(screen.getByRole('button',{name:'記録して追跡'}));await screen.findByRole('alert');
 const first=vi.mocked(savePurchase).mock.calls[0][0];expect(sessionStorage.getItem('taskflow.purchase.pending:u')).toContain(first.id);
 fireEvent.click(screen.getByRole('button',{name:'同じ報告を再試行'}));await screen.findByText(/購入報告を記録しました/);
 expect(vi.mocked(savePurchase).mock.calls[1][0]).toEqual(first);expect(uploadCommentAttachment).toHaveBeenCalledOnce();expect(sessionStorage.getItem('taskflow.purchase.pending:u')).toBeNull();
});
it('does not record the old user image after account switching during upload',async()=>{
 let finish!:(value:typeof attachment)=>void;vi.mocked(uploadCommentAttachment).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));await show();fireEvent.click(screen.getByRole('button',{name:'記録して追跡'}));await waitFor(()=>expect(uploadCommentAttachment).toHaveBeenCalled());
 owner.id='other';await act(async()=>finish(attachment));expect(savePurchase).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('ログインが変更');
});

it('restores a rejected pending report with its uploaded image for correction and retry',async()=>{
 const pending={id:'saved-report',projectId:'p',taskId:'t',report:prepared.report,track:true,attachment};sessionStorage.setItem('taskflow.purchase.pending:u',JSON.stringify(pending));
 vi.mocked(savePurchase).mockRejectedValueOnce(new PurchaseRequestError('Gmailが未接続です',true));
 render(<PurchaseReportDialog open onOpenChange={vi.fn()} userId="u"/>);
 fireEvent.click(await screen.findByRole('button',{name:'同じ報告を再試行'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('未接続'));
 fireEvent.click(screen.getByRole('button',{name:'報告だけ記録'}));await screen.findByText(/購入報告を記録しました/);
 expect(vi.mocked(savePurchase).mock.calls[1][0]).toEqual({...pending,track:false});expect(uploadCommentAttachment).not.toHaveBeenCalled();
});

it('allows an incomplete report on a completed parent while keeping tracking unavailable',async()=>{
 const incomplete={...prepared,report:{...prepared.report,merchant:'',orderNumber:'',stage:null,sourceText:'名刺を受け取りました。'},candidates:[{...prepared.candidates[0],trackingAvailable:false}]};
 vi.mocked(preparePurchase).mockResolvedValue(incomplete);vi.mocked(savePurchase).mockResolvedValue({commentId:'comment',taskId:'t',tracked:false,alreadyApplied:false});
 await show();expect(screen.getByRole('button',{name:'記録して追跡'})).toBeDisabled();
 fireEvent.change(screen.getByRole('textbox',{name:'記録する報告'}),{target:{value:'名刺を受け取りました。欠けはありません。'}});
 fireEvent.click(screen.getByRole('button',{name:'報告だけ記録'}));await screen.findByText(/購入報告を記録しました/);
 expect(vi.mocked(savePurchase).mock.calls[0][0]).toMatchObject({track:false,report:{orderNumber:'',stage:null,sourceText:'名刺を受け取りました。欠けはありません。'}});
 expect(uploadCommentAttachment).toHaveBeenCalledOnce();
});
it('keeps the uploaded attachment when a tracking rejection is followed by report-only saving',async()=>{
 vi.mocked(savePurchase).mockRejectedValueOnce(new PurchaseRequestError('別の注文を追跡中です',true));
 await show();fireEvent.click(screen.getByRole('button',{name:'記録して追跡'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'報告だけ記録'}));await screen.findByText(/購入報告を記録しました/);
 expect(uploadCommentAttachment).toHaveBeenCalledOnce();
 expect(vi.mocked(savePurchase).mock.calls[1][0]).toEqual({...vi.mocked(savePurchase).mock.calls[0][0],track:false});
});
