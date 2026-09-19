'use client';
import {getAuthHeaders} from '@/lib/firebase/authToken';
import {useAuthStore} from '@/stores/authStore';
import {isE2EMockAuthEnabled} from '@/lib/firebase/testMode';
import type {AIProviderType} from '@/types/ai';
import type {PurchaseReport} from './types';
import type {PurchaseSubmission} from './submission';
export interface PurchasePreparation {report:PurchaseReport;candidates:{key:string;projectId:string;taskId:string;projectName:string;title:string;trackingAvailable?:boolean}[];suggested:string[]}
export class PurchaseRequestError extends Error { constructor(message:string,public rejected:boolean){super(message);} }
export async function purchaseRequest<T>(body:Record<string,unknown>):Promise<T>{
 const uid=useAuthStore.getState().user?.id;
 const headers=await getAuthHeaders();if(!uid||useAuthStore.getState().user?.id!==uid)throw new Error('ログインが変更されました。');
 const response=await fetch('/api/ai/purchase-report',{method:'POST',headers,body:JSON.stringify(body)});
 const data=await response.json();if(useAuthStore.getState().user?.id!==uid)throw new Error('ログインが変更されました。');if(!response.ok)throw new PurchaseRequestError(data.error||'報告を確認できませんでした。',data.rejected===true);return data;
}
export async function preparePurchase(text:string,file:File|null,provider:AIProviderType,model?:string):Promise<PurchasePreparation>{
 if(isE2EMockAuthEnabled())throw new Error('隔離環境ではAIへ画像を送信しません。「名刺の例で試す」を使えます。');
 const owner=useAuthStore.getState().user?.id;
 let image:string|undefined;
 if(file){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('10MB以内のPNG・JPEG・WebPを選んでください。');
  const bitmap=await createImageBitmap(file);try{const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));const ctx=canvas.getContext('2d');if(!ctx)throw new Error('画像を開けませんでした。');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);image=canvas.toDataURL('image/jpeg',.9);}finally{bitmap.close();}
 }
 if(!owner || useAuthStore.getState().user?.id!==owner)throw new Error('ログインが変更されました。');
 return purchaseRequest({action:'prepare',text,image,provider,model});
}
export async function savePurchase(submission:PurchaseSubmission):Promise<{commentId:string;taskId:string;tracked:boolean;backgroundConfigured?:boolean;alreadyApplied:boolean}>{
 if(isE2EMockAuthEnabled()){const {savePurchaseMock}=await import('./mock');return savePurchaseMock(submission);}
 return purchaseRequest({action:'record',submission});
}
