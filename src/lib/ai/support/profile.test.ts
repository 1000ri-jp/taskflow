import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_SUPPORT, parseSupportProfile, supportInstructions, presentationFor, withSupportFeedback } from './profile';

describe('private AI support preferences', () => {
  it('leaves unregistered users unchanged and suppresses all saved material when disabled', () => {
    expect(supportInstructions(DEFAULT_AI_SUPPORT)).toBe('');
    const profile = { enabled: false, wishes: 'PRIVATE-WISH', referenceNotes: 'PRIVATE-REFERENCE', approach: 'PRIVATE-APPROACH' };
    expect(supportInstructions(profile)).toBe('');
    const once = supportInstructions(profile, '全体を見たい');
    expect(once).toContain('全体を見たい'); expect(once).not.toContain('PRIVATE');
  });
  it('limits personalization to presentation and treats reference material as tentative', () => {
    const prompt = supportInstructions({ ...DEFAULT_AI_SUPPORT, wishes: '端的に', referenceNotes: 'タイプは参考', approach: '次の一歩' }, '理由を先に');
    expect(prompt).toContain('直近の本人の明示的な希望');
    expect(prompt).toContain('担当・期限・完了条件・権限・共有データを個人特性から変更しません');
    expect(prompt).toContain('無反応から好みを推測・保存しません');
    expect(prompt).toContain('"thisResponseOnly":"理由を先に"');
  });
  it('accepts optional blanks and rejects owner overrides, wrong types and oversized input', () => {
    expect(parseSupportProfile(DEFAULT_AI_SUPPORT)).toEqual(DEFAULT_AI_SUPPORT);
    for (const value of [{ ...DEFAULT_AI_SUPPORT, userId: 'other' }, { ...DEFAULT_AI_SUPPORT, enabled: 'yes' }, { ...DEFAULT_AI_SUPPORT, wishes: 'x'.repeat(2001) }]) expect(() => parseSupportProfile(value)).toThrow();
  });
});

it('keeps wishes and references when feedback changes and never infers layout from traits', () => {
 const original={...DEFAULT_AI_SUPPORT,wishes:'端的に',referenceNotes:'全体を見たいタイプと言われた'};
 expect(presentationFor(original)).toBe('brief');
 const next=withSupportFeedback(original,'全体を見たい');
 expect(next).toMatchObject({wishes:'端的に',referenceNotes:original.referenceNotes,presentation:'overview'});
 expect(withSupportFeedback(next,'もっと短く')).toMatchObject({feedback:'もっと短く',presentation:'brief'});
 expect(presentationFor({...next,enabled:false})).toBe('brief');
 expect(presentationFor({...next,enabled:false},'全体を見たい')).toBe('overview');
 expect(supportInstructions({...next,enabled:false})).toBe('');
 expect(supportInstructions(next,'今は提案不要')).toContain('latestFeedback');
});

const referenceResults = { natal: '太陽：牡羊座', mbti: 'INTJ', strengths: ['着想', '', '学習欲'] };
it('round trips typed references, preserves ranks and legacy notes, and connects them to AI', () => {
 const profile = parseSupportProfile({ ...DEFAULT_AI_SUPPORT, wishes: 'まず一言で', referenceNotes: '以前の記入', references: referenceResults });
 expect(parseSupportProfile(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
 expect(profile.references?.strengths).toEqual(['着想', '', '学習欲']);
 const instructions = supportInstructions(profile, '全体を見たい');
 expect(instructions).toContain(JSON.stringify(referenceResults));
 expect(instructions).toContain('以前の記入');
 expect(instructions).toContain('まず一言で');
 expect(instructions).toContain('空欄の順位は未登録');
 expect(supportInstructions({ ...profile, enabled: false }, 'もっと短く')).not.toContain('太陽');
 expect(supportInstructions({ ...profile, enabled: false }, 'もっと短く')).not.toContain('着想');
 expect(supportInstructions({ ...DEFAULT_AI_SUPPORT, references: { natal: '', mbti: '', strengths: ['', ''] } })).toBe('');
});
it('rejects malformed, oversized or unexpected reference fields', () => {
 for (const references of [null, [], { ...referenceResults, mbti: 'UNKNOWN' }, { ...referenceResults, natal: 'a'.repeat(6001) }, { ...referenceResults, strengths: [9] }, { ...referenceResults, strengths: Array(35).fill('着想') }, { ...referenceResults, strengths: ['x'.repeat(81)] }, { ...referenceResults, userId: 'other' }]) {
  expect(() => parseSupportProfile({ ...DEFAULT_AI_SUPPORT, references })).toThrow();
 }
});
