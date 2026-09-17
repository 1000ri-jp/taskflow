import {validateCommentSubmission} from '../commentSubmission';
import type { CommentAttachment } from '@/types';
import { parsePurchaseReport, validPurchaseIdentity, type PurchaseReport } from './types';
export interface PurchaseSubmission { id:string; projectId:string; taskId:string; report:PurchaseReport; attachment:CommentAttachment|null; track:boolean }
export function parsePurchaseSubmission(raw: unknown): PurchaseSubmission {
  if (!raw || typeof raw!=='object') throw new Error('報告内容を確認してください。');
  const v=raw as PurchaseSubmission;
  if (![v.id,v.projectId,v.taskId].every(s=>typeof s==='string'&&/^[\w-]{1,100}$/.test(s)) || typeof v.track!=='boolean')throw new Error('報告先を確認してください。');
  const report=parsePurchaseReport(v.report);
  if (v.track && (!validPurchaseIdentity(report) || report.stage===null)) throw new Error('追跡には店名・注文番号・商品と、注文の状態が必要です。報告だけなら先に残せます。');
  let attachment:CommentAttachment|null=null;
  if(v.attachment!==null){
    const a=v.attachment;
    validateCommentSubmission({id:v.id,projectId:v.projectId,taskId:v.taskId,authorId:'purchase',authorName:'本人',content:'購入報告',notifyIds:[],review:null,attachments:[a]});
    const url=new URL(a.url),path=decodeURIComponent(url.pathname);
    if(url.origin!=='https://firebasestorage.googleapis.com'||!new RegExp(`^/v0/b/[^/]+/o/projects/${v.projectId}/tasks/${v.taskId}/comment_attachments/[^/]+$`).test(path)||a.name.length>255||a.size>10*1024*1024||!['image/png','image/jpeg','image/webp'].includes(a.type))throw new Error('このタスクの添付画像を選んでください。');
    attachment={id:a.id,url:a.url,name:a.name,type:a.type,size:a.size};
  }
  if (!purchaseReportText(report).trim() && !attachment) throw new Error('報告の本文か画像を添えてください。');
  return {id:v.id,projectId:v.projectId,taskId:v.taskId,report,attachment,track:v.track};
}
export function purchaseReportText(report: PurchaseReport) {
  return [
    [report.merchant,report.item].filter(Boolean).join('：'),
    report.orderNumber ? `注文番号：${report.orderNumber}` : '',
    report.orderedOn ? `注文日：${report.orderedOn}` : '',
    report.expectedDate ? `到着予定：${report.expectedDate}` : '',
    report.sourceText,
  ].filter(Boolean).join('\n');
}
