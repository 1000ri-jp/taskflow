import type { EvidenceStage } from '../automationTypes';
export interface PurchaseIdentity { merchant: string; orderNumber: string; item: string; orderedOn: string | null }
export interface PurchaseReport extends PurchaseIdentity { stage: EvidenceStage | null; expectedDate: string | null; sourceText: string; question: string }
export function calendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
export function validPurchaseIdentity(value: PurchaseIdentity): boolean {
  return !!value && [value.merchant,value.orderNumber,value.item].every(v => typeof v === 'string' && v.trim().length >= 2 && v.length <= 200) && (value.orderedOn === null || calendarDate(value.orderedOn));
}
export function parsePurchaseReport(value: unknown): PurchaseReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('購入報告を読み取れませんでした。');
  const v = value as PurchaseReport;
  if (![v.merchant,v.orderNumber,v.item,v.sourceText,v.question].every(s => typeof s === 'string') || [v.merchant,v.orderNumber,v.item].some(s=>s.length>200) || v.sourceText.length>10000 || v.question.length>500 ||
    v.orderedOn !== null && !calendarDate(v.orderedOn) || v.expectedDate !== null && !calendarDate(v.expectedDate) || v.stage !== null && !['ordered','paid','in_production','shipped','expected','received','cancelled','refunded'].includes(v.stage)) throw new Error('読み取った注文情報を確認してください。');
  return { merchant:v.merchant.trim(), orderNumber:v.orderNumber.trim(), item:v.item.trim(), orderedOn:v.orderedOn, stage:v.stage, expectedDate:v.expectedDate, sourceText:v.sourceText, question:v.question };
}

/** A repeated order receipt must not replace a newer shipment or delivery fact. */
export function mergePurchaseProgress(current:EvidenceStage|null,eta:string|null,report:PurchaseReport){
 const rank:Partial<Record<EvidenceStage,number>>={ordered:0,paid:1,in_production:2,shipped:3,expected:3,received:4,cancelled:5,refunded:6};
 const earlier=current&&report.stage!=='expected'&&(rank[report.stage!]??-1)<(rank[current]??-1);
 const stage=earlier?current:report.stage==='expected'&&current?current:report.stage;
 return {stage,expectedDate:['cancelled','refunded'].includes(stage??'')?null:earlier?eta:report.expectedDate??eta};
}
