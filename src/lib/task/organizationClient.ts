import { getAuthHeaders } from '@/lib/firebase/authToken';
import { isE2EMockAuthEnabled } from '@/lib/firebase/testMode';
export class OrganizationRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function requestOrganization<T>(body:Record<string,unknown>):Promise<T> {
  const notify = () => { if (['preview','apply','undo','hold','skip','reopen','defer','reconsider'].includes(String(body.action))) window.dispatchEvent(new Event('taskflow-organization-updated')); };
  if(isE2EMockAuthEnabled()) {
    try { const result = await (await import('./organizationMock')).requestOrganizationMock(body) as T; notify(); return result; }
    catch (error) {
      if (error instanceof Error && 'status' in error && typeof error.status === 'number') throw new OrganizationRequestError(error.message,error.status);
      throw error;
    }
  }
  const response=await fetch('/api/tasks/organize',{method:'POST',headers:await getAuthHeaders(),cache:'no-store',body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new OrganizationRequestError(data?.error||'整理案を反映できませんでした。',response.status);
  if(['apply','undo'].includes(String(body.action)))window.dispatchEvent(new Event('taskflow-work-updated'));
  notify();
  return data;
}
