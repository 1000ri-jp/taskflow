import {NextRequest,NextResponse} from 'next/server';
import {verifyAuthToken} from '@/lib/firebase/admin';
import {isValidProvider} from '@/lib/ai/providers';
import {preparePurchaseReport} from '@/lib/task/purchase/prepare';
import {recordPurchaseReport,AutomationError} from '@/lib/task/automationRepository';
import type {AIMessage} from '@/types/ai';
export const runtime='nodejs';
export const maxDuration=60;
const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest){
  let uid:string;try{uid=(await verifyAuthToken(request.headers.get('Authorization'))).uid;}catch{return json({error:'ログインを確認してください。'},401);}
  try{
    const raw=await request.text();if(raw.length>6000000)return json({error:'画像を小さくして、もう一度お試しください。'},413);
    const body=JSON.parse(raw);
    if(body.action==='record')return json(await recordPurchaseReport(uid,body.submission));
    if(body.action!=='prepare'||!isValidProvider(body.provider)||typeof body.text!=='string'||body.text.length>10000||body.model!==undefined&&(typeof body.model!=='string'||body.model.length>200))return json({error:'報告内容を確認してください。'},400);
    let images:AIMessage['images'];
    if(body.image){const match=typeof body.image==='string'?/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.image):null;if(!match) return json({error:'PNG・JPEG・WebPの画像を選んでください。'},400);images=[{mimeType:match[1] as 'image/png',data:match[2]}];}
    if(!body.text.trim()&&!images)return json({error:'報告か画像を添えてください。'},400);
    return json(await preparePurchaseReport(uid,body.text,images,body.provider,body.model));
  }catch(error){return json({rejected:error instanceof AutomationError,error:error instanceof AutomationError?error.message:'購入報告を処理できませんでした。入力を残しています。'},error instanceof AutomationError?error.status:503);}
}
