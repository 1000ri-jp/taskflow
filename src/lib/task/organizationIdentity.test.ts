// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { assertOrganizationBasis, createOrganizationBasis, organizationBasisMatches, organizationComparableWrites, organizationScope, organizationSourceFingerprint } from './organizationIdentity';
const source={kind:'meeting' as const,id:'one',title:'朝会',text:'確認して公開する\r\n',occurredAt:'2026-09-12T09:00:00+09:00'};
const data=()=>({tasks:{a:{title:'原稿'},b:{title:'別の仕事'}},children:{'tasks/a/comments/c':{content:'確定'},'tasks/a/checklists/l':{items:[{isChecked:false}]}}});
describe('organization analysis basis',()=>{
  it('uses actual transcript and meeting time, not upload filename or heading',async()=>{
    expect(await organizationSourceFingerprint(source)).toBe(await organizationSourceFingerprint({...source,id:'two',title:'別ファイル',text:'確認して公開する\n',occurredAt:'2026-09-12T00:00:00Z'}));
    expect(await organizationSourceFingerprint(source)).not.toBe(await organizationSourceFingerprint({...source,occurredAt:'2026-09-13T00:00:00Z'}));
    const incoming={...source,kind:'incoming' as const,incoming:{service:'gmail' as const,id:'message',version:'v1',connectionEpoch:'one'}};
    expect(await organizationSourceFingerprint(incoming)).not.toBe(await organizationSourceFingerprint({...incoming,incoming:{...incoming.incoming,connectionEpoch:'two'}}));
  });
  it('ignores unrelated edits but detects affected comment/checklist edits and newly attached children',async()=>{
    const original=data();const basis=await createOrganizationBasis('p',source,original);original.tasks.b.title='独立した変更';
    expect(await organizationBasisMatches(basis,'p',source,original,['a'])).toBe(true);
    original.children['tasks/a/comments/c'].content='変更';expect(await organizationBasisMatches(basis,'p',source,original,['a'])).toBe(false);
    const child=data();Object.assign(child.tasks.b,{parentTaskId:'a'});expect(await organizationBasisMatches(basis,'p',source,child,['a'])).toBe(false);
    const checklist=data();checklist.children['tasks/a/checklists/l'].items[0].isChecked=true;expect(await organizationBasisMatches(basis,'p',source,checklist,['a'])).toBe(false);
  });
  it('rejects malformed or foreign analysis snapshots and preserves manual preview support',async()=>{
    const draft={kind:'complete' as const,taskIds:['a'],reason:'確認済み',quote:'確認'};
    await expect(assertOrganizationBasis('p',source,data(),draft,undefined)).resolves.toBeUndefined();
    await expect(assertOrganizationBasis('p',source,data(),draft,null)).rejects.toMatchObject({status:409});
    const basis=await createOrganizationBasis('other',source,data());
    await expect(assertOrganizationBasis('p',source,data(),draft,basis)).rejects.toMatchObject({status:409});
  });
  it('ignores placement only for new tasks and retains task content and existing/subdocument ordering',()=>{
    const create={path:'tasks/new',before:null,after:{title:'公開手順',order:3}};
    const normalize=(write:typeof create)=>organizationComparableWrites([write]);
    expect(normalize(create)).toEqual(normalize({...create,after:{...create.after,order:4}}));
    expect(normalize(create)).not.toEqual(normalize({...create,after:{...create.after,title:'別の仕事'}}));
    for(const write of [{...create,before:{title:'元の仕事',order:1}},{...create,path:'tasks/a/checklists/new'}]) {
      expect(organizationComparableWrites([write])).not.toEqual(organizationComparableWrites([{...write,after:{...write.after,order:4}}]));
    }
    expect(create.after.order).toBe(3);
  });
  it('includes project and list assignee defaults in the preview signature scope',()=>{
    const scoped={...data(),defaultAssigneeId:'project-owner',listDefaultAssigneeIds:{work:'list-owner'},listIds:['work']};
    expect(organizationScope(scoped,['a'])).toMatchObject({defaultAssigneeId:'project-owner',listDefaultAssigneeIds:{work:'list-owner'},listIds:['work']});
    expect(organizationScope({...scoped,listDefaultAssigneeIds:{work:'another-owner'}},['a'])).not.toEqual(organizationScope(scoped,['a']));
    expect(organizationScope({...scoped,defaultAssigneeId:'another-owner'},['a'])).not.toEqual(organizationScope(scoped,['a']));
  });
});
