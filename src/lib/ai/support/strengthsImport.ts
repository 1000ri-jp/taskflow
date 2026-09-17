import { REFERENCE_LIMITS } from './profile';

/** Import supplied ranks only. Never infer missing themes or reorder an unnumbered result. */
export function parseStrengthsResult(input: string): string[] {
  const text = input.trim().replace(/^```(?:json|text)?\s*\n?/i, '').replace(/\n?```$/, '').trim();
  if (!text || text.length > 20000) throw new Error('結果を貼り付けてください（2万文字まで）。');
  let strengths: string[];
  if (/^[{\[]/.test(text)) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('JSONが途中で切れていないか確認してください。'); }
    const values = Array.isArray(data) ? data : data && typeof data === 'object' && 'strengths' in data ? data.strengths : null;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new Error('strengths の配列、または資質名の配列を貼り付けてください。');
    strengths = values.map(value => value.trim());
  } else {
    const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const ranked = lines.map(line => line.match(/^(?:[-*・]\s*)?(\d{1,2})(?:位[.．:：、]?|[.．)）:：、]|\s)\s*(.+)$/)).filter(match => match !== null);
    if (ranked.length) {
      strengths = [];
      const seen = new Set<number>();
      for (const match of ranked) {
        const rank = Number(match[1]);
        if (rank < 1 || rank > REFERENCE_LIMITS.strengths || seen.has(rank)) throw new Error('順位は1〜34位で、重複しない形にしてください。');
        seen.add(rank); strengths[rank - 1] = match[2].trim();
      }
      strengths = Array.from({ length: strengths.length }, (_, index) => strengths[index] ?? '');
    } else {
      strengths = text.split(/[\r\n,、\t]+/).map(value => value.trim().replace(/^[-*・]\s*/, '').replace(/^["「『]|["」』]$/g, '')).filter(Boolean);
    }
  }
  const values = strengths.filter(Boolean);
  if (!values.length || strengths.length > REFERENCE_LIMITS.strengths) throw new Error('資質名は1〜34件で貼り付けてください。');
  if (values.some(value => value.length > REFERENCE_LIMITS.strength || /[{}\[\]。！？]/.test(value))) throw new Error('説明文を除き、順位と資質名を貼り付けてください。');
  if (new Set(values.map(value => value.normalize('NFKC').toLowerCase())).size !== values.length) throw new Error('同じ資質が重複しています。結果の順位を確認してください。');
  return strengths;
}
