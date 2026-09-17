import { describe, expect, it } from 'vitest';
import { parseStrengthsResult } from './strengthsImport';
describe('import supplied strengths results', () => {
  it('accepts copied JSON and code fences without treating syntax as themes', () => {
    const strengths = ['最上志向', '調和性', '規律性'];
    expect(parseStrengthsResult(JSON.stringify({ strengths }))).toEqual(strengths);
    expect(parseStrengthsResult('```json\n' + JSON.stringify({ strengths }) + '\n```')).toEqual(strengths);
    expect(parseStrengthsResult(JSON.stringify(strengths))).toEqual(strengths);
  });
  it('uses explicit ranks, including full-width numbers, and leaves missing ranks empty', () => {
    expect(parseStrengthsResult('あなたの結果\n３位 規律性\n説明文です。\n１．最上志向')).toEqual(['最上志向', '', '規律性']);
  });
  it('preserves the order of an unnumbered list', () => {
    expect(parseStrengthsResult('最上志向、調和性\n規律性')).toEqual(['最上志向', '調和性', '規律性']);
  });
  it.each(['', '{"strengths":', '{"strengths":[1]}', '1. 調和性\n1. 規律性', '35. 規律性', '調和性\n調和性', '説明文だけです。', Array.from({length:35},(_,i)=>`資質${i}`).join('\n')])('rejects malformed or ambiguous input without inventing a result: %s', text => {
    expect(() => parseStrengthsResult(text)).toThrow();
  });
});
