/* eslint-disable @next/next/no-img-element -- Local blob preview is not served by the Next image optimizer. */
'use client';
import {useEffect,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Input} from '@/components/ui/input';
import {useAISettingsStore} from '@/stores/aiSettingsStore';
import {uploadCommentAttachment} from '@/lib/firebase/storage';
import {isE2EMockAuthEnabled} from '@/lib/firebase/testMode';
import {STAGE_LABELS} from '@/lib/task/automationTypes';
import {useAuthStore} from '@/stores/authStore';
import {PurchaseRequestError,preparePurchase,savePurchase,type PurchasePreparation} from '@/lib/task/purchase/client';
import {validPurchaseIdentity} from '@/lib/task/purchase/types';
import {parsePurchaseSubmission,purchaseReportText,type PurchaseSubmission} from '@/lib/task/purchase/submission';
import {sourceCommentHref} from '@/lib/task/commentSubmission';
export default function PurchaseReportDialog({open,onOpenChange,userId,initialFile=null,initialText='',onRecorded}:{open:boolean;onOpenChange:(open:boolean)=>void;userId:string;initialFile?:File|null;initialText?:string;onRecorded?:()=>void}){
 const settings=useAISettingsStore(),mock=isE2EMockAuthEnabled();
 const [text,setText]=useState(initialText),[file,setFile]=useState<File|null>(initialFile),[preview,setPreview]=useState('');
 const [prepared,setPrepared]=useState<PurchasePreparation|null>(null),[target,setTarget]=useState(''),[edit,setEdit]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState<{href:string;tracked:boolean;backgroundConfigured?:boolean}|null>(null);
 const key=`taskflow.purchase.pending:${userId}`;
 const attempt=useRef<PurchaseSubmission|null>(null),lock=useRef(false),uploadId=useRef<string|null>(null);
 const restored=useRef<PurchaseSubmission|null>(null);
 const assertOwner=()=>{if(useAuthStore.getState().user?.id!==userId)throw new Error('ログインが変更されました。');};
 useEffect(()=>{if(!file)return;const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
 useEffect(()=>{try{const saved=sessionStorage.getItem(key);if(saved){const pending=parsePurchaseSubmission(JSON.parse(saved));attempt.current=pending;restored.current=pending;uploadId.current=pending.id;setPrepared({report:pending.report,candidates:[{key:`${pending.projectId}/${pending.taskId}`,projectId:pending.projectId,taskId:pending.taskId,title:'前回選んだ仕事',projectName:''}],suggested:[]});setTarget(`${pending.projectId}/${pending.taskId}`);setText(purchaseReportText(pending.report));setError('前回の報告を保持しています。同じ受付で結果を確認できます。');}}catch{setError('前回の報告を読み込めませんでした。');}},[key]);
 const analyze=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{assertOwner();const result=await preparePurchase(text,file,settings.provider,settings.getActiveModel());assertOwner();setPrepared(result);setTarget(result.suggested.length===1?result.suggested[0]:'');}catch(e){setError(e instanceof Error?e.message:'読み取りに失敗しました。');}finally{lock.current=false;setBusy(false);}};
 const record=async(track:boolean)=>{if(lock.current)return;const choice=prepared?.candidates.find(t=>t.key===target);if(!attempt.current&&(!choice||!prepared))return;lock.current=true;setBusy(true);setError('');try{
   if(!attempt.current){
     assertOwner();const id=uploadId.current??crypto.randomUUID();uploadId.current=id;const submission:PurchaseSubmission={id,projectId:choice!.projectId,taskId:choice!.taskId,report:prepared!.report,track,attachment:null};
     // Retrying an upload uses this same report ID and the existing task attachment path.
     if(restored.current?.projectId===submission.projectId&&restored.current?.taskId===submission.taskId)submission.attachment=restored.current.attachment;
     else if(file&&!mock)submission.attachment=await uploadCommentAttachment(submission.projectId,submission.taskId,file,`purchase-${id}`);
     assertOwner();restored.current=submission;sessionStorage.setItem(key,JSON.stringify(submission));attempt.current=submission;
   }
   assertOwner();sessionStorage.setItem(key,JSON.stringify(attempt.current));const result=await savePurchase(attempt.current!);assertOwner();const s=attempt.current!;setReceipt({href:sourceCommentHref(s.projectId,s.taskId,result.commentId),tracked:result.tracked,backgroundConfigured:result.backgroundConfigured});sessionStorage.removeItem(key);window.dispatchEvent(new Event('taskflow-work-updated'));if(result.tracked)window.dispatchEvent(new Event('taskflow-automation-request'));onRecorded?.();
 }catch(e){if(e instanceof PurchaseRequestError&&e.rejected){attempt.current=null;sessionStorage.removeItem(key);}setError(e instanceof Error?e.message:'受付を確認できませんでした。同じ報告を再試行できます。');}finally{lock.current=false;setBusy(false);}};
 const example=async(completed=false)=>{const {preparePurchaseExample}=await import('@/lib/task/purchase/mock');const result=await preparePurchaseExample(completed);setPrepared(result);setTarget(result.suggested[0]);};
 const canReport=!!prepared&&!!target&&!!(purchaseReportText(prepared.report).trim()||file||restored.current?.attachment);
 const canTrack=canReport&&!!prepared?.report.stage&&validPurchaseIdentity(prepared.report)&&prepared.candidates.find(c=>c.key===target)?.trackingAvailable!==false;
 return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="max-h-[88dvh] overflow-y-auto bg-white sm:max-w-xl" onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>モアイに購入報告</DialogTitle><DialogDescription>注文の画像や報告を、同じ仕事に残します。</DialogDescription></DialogHeader>
 {receipt?<div className="space-y-3"><p role="status">購入報告を記録しました。{receipt.tracked?(receipt.backgroundConfigured?'この注文のメールを追跡します。':'TaskFlowを開いている間、この注文のメールを確認します。'):''}</p><a className="text-sm underline" href={receipt.href}>仕事を見る</a>{mock&&receipt.tracked&&<div className="flex flex-wrap gap-2">{(['printing','shipment','delay','received'] as const).map((kind,i)=><Button key={kind} variant="outline" size="sm" onClick={()=>void import('@/lib/task/purchase/mock').then(m=>m.simulatePurchaseMail(kind))}>{['印刷開始の例','発送メールの例','到着遅延の例','配達完了の例'][i]}</Button>)}</div>}</div>:<>
 {!prepared&&!attempt.current&&<><Textarea aria-label="購入報告" value={text} onChange={e=>setText(e.target.value)} placeholder="名刺を注文したよ。画像だけでもどうぞ。" disabled={busy}/><label className="text-sm">購入画面の画像<input type="file" aria-label="購入画面の画像" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>{preview&&<img src={preview} alt="報告する購入画面" className="max-h-44 max-w-full rounded border object-contain"/>}<div className="flex flex-wrap gap-2"><Button disabled={busy||(!text.trim()&&!file)} onClick={()=>void analyze()}>{busy?'読み取り中…':'モアイに報告'}</Button>{mock&&<><Button variant="outline" onClick={()=>void example()}>名刺の例で試す</Button><Button variant="outline" onClick={()=>void example(true)}>番号なし・完了済みの例</Button><Button variant="outline" onClick={()=>void import('@/lib/task/purchase/mock').then(m=>m.simulateUrgentRequest()).then(()=>onOpenChange(false))}>至急依頼の例</Button></>}</div></>}
 {prepared&&<div className="space-y-3"><p className="text-sm font-medium">{[prepared.report.merchant,prepared.report.item].filter(Boolean).join(' · ')||'購入の報告'}</p><p className="text-xs">注文番号 {prepared.report.orderNumber||'未取得'} · {prepared.report.stage?STAGE_LABELS[prepared.report.stage]:'成立は未確認'}</p>{prepared.report.expectedDate&&<p className="text-sm">到着予定 {prepared.report.expectedDate}</p>}
 <label className="block space-y-1 text-sm">記録する仕事<select aria-label="記録する仕事" value={target} disabled={busy||!!attempt.current} onChange={e=>setTarget(e.target.value)} className="block w-full rounded border bg-white p-2"><option value="">該当する仕事を選ぶ</option>{prepared.candidates.map(c=><option key={c.key} value={c.key}>{c.projectName} / {c.title}</option>)}</select></label>
 {prepared.report.question&&<p className="text-sm text-amber-800">{prepared.report.question}</p>}
 <button type="button" className="text-xs underline" disabled={busy||!!attempt.current} onClick={()=>setEdit(v=>!v)}>{edit?'読み取りを閉じる':'読み取りを直す'}</button>
 {edit&&<div className="space-y-2">{(['merchant','orderNumber','item','orderedOn','expectedDate'] as const).map((field,i)=><label key={field} className="block text-xs">{['ショップ','注文番号','商品','注文日','到着予定'][i]}<Input disabled={busy||!!attempt.current} type={i>2?'date':'text'} value={prepared.report[field]??''} onChange={e=>setPrepared({...prepared,report:{...prepared.report,[field]:i>2?e.target.value||null:e.target.value}})}/></label>)}<Textarea aria-label="追加の報告" disabled={busy||!!attempt.current} value={text} onChange={e=>setText(e.target.value)} /><Button variant="outline" disabled={busy||!!attempt.current} onClick={()=>void analyze()}>補足して読み取り直す</Button></div>}
 <label className="block space-y-1 text-sm">記録する報告<Textarea aria-label="記録する報告" value={prepared.report.sourceText} disabled={busy||!!attempt.current} onChange={e=>setPrepared({...prepared,report:{...prepared.report,sourceText:e.target.value}})}/></label><p className="text-xs text-muted-foreground">購入報告と画像は、選んだ仕事のメンバーが見られます。到着予定は期限と分けて表示します。</p>
 </div>}
 {attempt.current?<Button disabled={busy} onClick={()=>void record(attempt.current!.track)}>{busy?'記録中…':'同じ報告を再試行'}</Button>:prepared&&<div className="space-y-2"><div className="flex flex-wrap gap-2"><Button disabled={busy||!canReport} onClick={()=>void record(false)}>報告だけ記録</Button><Button variant="outline" disabled={busy||!canTrack} onClick={()=>void record(true)}>記録して追跡</Button></div>{canTrack&&<p className="text-xs text-muted-foreground">追跡では、この注文の状態と到着予定を仕事に反映します。期限・完了は変更せず、メール本文も共有しません。</p>}{!canTrack&&canReport&&<p className="text-xs text-muted-foreground">{prepared.candidates.find(c=>c.key===target)?.trackingAvailable===false?'この仕事への報告を残せます。追跡は進行中の仕事で始められます。':'報告はこのまま残せます。追跡には店名・注文番号・商品・注文の状態が必要です。'}</p>}</div>}
 {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
 </>}
 </DialogContent></Dialog>;
}
