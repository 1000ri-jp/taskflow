import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthToken } from '@/lib/firebase/admin';
import { isValidProvider } from '@/lib/ai/providers';
import { OrganizationError, validateOrganizationDraft, validOrganizationId } from '@/lib/task/organizationEngine';
import { actOnOrganization, listOrganization, previewOrganization, readOrganizationSource, organizationContext, reconsiderOrganization } from '@/lib/task/organizationRepository';
import { analyzeManyOrganizations, analyzeOrganization } from '@/lib/task/organizationAnalysis';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}});
export async function POST(request:NextRequest) {
  let user;
  try { user=await verifyAuthToken(request.headers.get('Authorization')); } catch { return json({error:'ログインを確認してください。'},401); }
  if (!user.email?.toLowerCase().endsWith('@1000ri.jp')) return json({error:'このアカウントは利用対象外です。'},403);
  try {
    const text=await request.text(); if(text.length>200000) throw new OrganizationError('資料が入力上限を超えています。');
    let data; try {data=JSON.parse(text);} catch {throw new OrganizationError('入力形式を確認してください。');}
    if(!data || typeof data !== 'object' || Array.isArray(data)) throw new OrganizationError('プロジェクトを確認してください。');
    if(data.action==='analyze_many') {
      if(Object.keys(data).some(key => !['action','projectIds','source','provider','model'].includes(key)) || !Array.isArray(data.projectIds) || !data.projectIds.length || data.projectIds.length > 20 || !data.projectIds.every(validOrganizationId) || new Set(data.projectIds).size !== data.projectIds.length) throw new OrganizationError('照合するプロジェクトは重複なく1〜20件で指定してください。');
      if(!isValidProvider(data.provider) || data.model!==undefined && (typeof data.model!=='string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(data.model))) throw new OrganizationError('AI設定を確認してください。');
      return json(await analyzeManyOrganizations(user.uid,data.projectIds,data.source,data.provider,data.model));
    }
    if(Object.keys(data).some(key => !['action','projectId','source','draft','provider','model','id','basis','confirmed','followUp'].includes(key)) || !validOrganizationId(data.projectId) || data.confirmed !== undefined && typeof data.confirmed !== 'boolean') throw new OrganizationError('プロジェクトを確認してください。');
    if(data.action==='context') return json(await organizationContext(user.uid,data.projectId));
    if(data.action==='reconsider') return json(await reconsiderOrganization(user.uid,data.projectId,data.id));
    if(data.action==='source') return json(await readOrganizationSource(user.uid,data.projectId,data.id));
    if(data.action==='list') return json(await listOrganization(user.uid,data.projectId));
    if(data.action==='preview') return json(await previewOrganization(user.uid,data.projectId,data.source,validateOrganizationDraft(data.draft),data.basis,data.confirmed));
    if(data.action==='analyze') {
      if(!isValidProvider(data.provider) || data.model!==undefined && (typeof data.model!=='string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(data.model))) throw new OrganizationError('AI設定を確認してください。');
      return json(await analyzeOrganization(user.uid,data.projectId,data.source,data.provider,data.model));
    }
    if(['apply','hold','undo','reopen','skip'].includes(data.action)) return json(await actOnOrganization(user.uid,data.projectId,data.id,data.action));
    if(data.action==='defer') return json(await actOnOrganization(user.uid,data.projectId,data.id,'defer',data.followUp));
    throw new OrganizationError('操作を確認してください。');
  } catch(error) {
    return json({error:error instanceof OrganizationError ? error.message : '取得・反映できませんでした。最新の情報を確認してください。'},error instanceof OrganizationError ? error.status : 503);
  }
}
