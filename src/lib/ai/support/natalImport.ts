import { REFERENCE_LIMITS } from './profile';

export const NATAL_FILE_ACCEPT = '.txt,.md,.json,text/plain,text/markdown,application/json';
export const NATAL_TEMPLATE_URL = '/templates/taskflow-natal-template.md';
const START = '<!-- TASKFLOW_NATAL_BEGIN -->';
const END = '<!-- TASKFLOW_NATAL_END -->';
const MAX_BYTES = 64 * 1024;

export function parseNatalFile(name: string, content: string): string {
  if (!/\.(txt|md|json)$/i.test(name)) throw new Error('TXT・MD・JSONのファイルを選んでください。');
  let text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (/^```(?:json|markdown|md|text|txt)?\n/.test(text) && text.endsWith('```')) text = text.replace(/^```[^\n]*\n/, '').slice(0, -3).trim();
  if (/\.json$/i.test(name)) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('JSONの形式を確認してください。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => key !== 'natal') || !('natal' in value) || typeof value.natal !== 'string') throw new Error('JSONは {"natal":"チャートの結果"} の形にしてください。');
    text = value.natal.trim();
  }
  if (text.includes(START) || text.includes(END)) {
    if (text.split(START).length !== 2 || text.split(END).length !== 2 || text.indexOf(END) < text.indexOf(START)) throw new Error('サンプルの記入欄が見つかりません。開始・終了の印を残してください。');
    text = text.slice(text.indexOf(START) + START.length, text.indexOf(END)).trim();
    const filled = text.split('\n').some(line => line.trim() && !/^\s*#/.test(line) && !/^[^:：]*[:：]\s*$/.test(line));
    if (!filled) throw new Error('サンプルにチャートの結果を記入してから取り込んでください。');
  }
  if (!text) throw new Error('ファイルにチャートの結果がありません。');
  if (text.length > REFERENCE_LIMITS.natal) throw new Error('ネイタルの結果は6000文字以内にしてください。');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw new Error('読み取れない文字が含まれています。UTF-8で保存してください。');
  return text;
}

export async function readNatalFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer'>): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('ファイルは64KBまでです。');
  if (!/\.(txt|md|json)$/i.test(file.name)) throw new Error('TXT・MD・JSONのファイルを選んでください。');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error('ファイルは64KBまでです。');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('UTF-8のテキストファイルを選んでください。'); }
  return parseNatalFile(file.name, text);
}
