import {mergePurchaseProgress,type PurchaseReport} from './types';
import {describe,it,expect} from 'vitest';
import {recognizePurchaseEvidence,deliveryDate} from './evidence';
import {completesCriterion,validRule,evidenceRuleVersion} from '../automationEngine';
import type {TaskEvidenceRule,TaskEvidence} from '../automationTypes';
const rule:TaskEvidenceRule={projectId:'p',taskId:'t',enabled:true,order:{merchant:'マヒトデザイン',orderNumber:'ORDER-1234',item:'名刺',orderedOn:'2026-09-14'},subject:'名刺',period:'',person:'u',sender:'',criterion:'tracking',sources:['gmail'],allowExpectedDate:false};
const evidence=(text:string):TaskEvidence=>({id:'mail',version:'1',source:'gmail',at:'2026-09-14T00:00:00Z',text,sender:'mail@example.test',authorId:'',url:'https://example.test/mail'});
const match=(text:string)=>recognizePurchaseEvidence(rule,'u',evidence('マヒトデザイン 注文番号 ORDER-1234\n'+text));
describe('order evidence',()=>{
 it('keeps payment, production, shipment, receipt and ETA separate',()=>{
  expect(validRule(rule)).toBe(true);
  expect(match('ご注文を承りました。')?.stage).toBe('ordered');
  expect(match('印刷を開始しました。')?.stage).toBe('in_production');
  expect(match('発送しました。お届け予定日：9月16日')).toMatchObject({stage:'shipped',expectedDate:'2026-09-16'});
  expect(match('配達完了。')?.stage).toBe('received');expect(completesCriterion('tracking','received')).toBe(false);
 });
 it.each(['到着予定日：9/16ではありません','到着予定日：9/16？','到着予定日：9/16は未確定です','発送予定です','まだ発送していません','発送しましたか？','発送したらお知らせください','> 発送しました。','On Monday wrote:\n発送しました。'])('does not treat request, future or quoted text as a fact: %s',text=>expect(match(text)).toBeNull());
 it('does not match another order from the same shop',()=>expect(recognizePurchaseEvidence(rule,'u',evidence('マヒトデザイン 注文番号 ORDER-12345 発送しました。'))).toBeNull());
 it('uses source year only for an unambiguous delivery date',()=>{
  expect(deliveryDate('到着予定：1/3','2026-12-30T00:00:00Z')).toBe('2027-01-03');
  expect(deliveryDate('到着予定：2026/2/30','2026-02-20T00:00:00Z')).toBeNull();
  expect(deliveryDate('到着予定：9/16。到着予定：9/18','2026-09-14T00:00:00Z')).toBeNull();
 });
 it('keeps old rule versions intact',()=>{
  const {order,...legacy}=rule;void order;expect(evidenceRuleVersion(legacy)).toBe(JSON.stringify([legacy.subject,legacy.period,legacy.person,legacy.criterion]));
 });
});

it('retains shipment and newer ETA when an old order receipt is reported again',()=>{
 const report={stage:'ordered',expectedDate:'2026-09-15'} as PurchaseReport;
 expect(mergePurchaseProgress('shipped','2026-09-18',report)).toEqual({stage:'shipped',expectedDate:'2026-09-18'});
 expect(mergePurchaseProgress('shipped','2026-09-18',{...report,stage:'expected',expectedDate:'2026-09-19'})).toEqual({stage:'shipped',expectedDate:'2026-09-19'});
});
