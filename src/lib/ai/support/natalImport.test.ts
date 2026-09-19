// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { parseNatalFile, readNatalFile } from './natalImport';

const sample = readFileSync(new URL('../../../../public/templates/taskflow-natal-template.md', import.meta.url), 'utf8');
it('imports only the filled body from the downloadable sample, excluding examples and AI instructions', () => {
  expect(() => parseNatalFile('sample.md', sample)).toThrow('記入してから');
  const filled = sample.replace('月：\n', '月：天秤座 / 第7ハウス\n');
  const result = parseNatalFile('filled.md', filled);
  expect(result).toContain('月：天秤座 / 第7ハウス');
  expect(result).not.toContain('牡羊座 12°34');
  expect(result).not.toContain('AIへの依頼');
  expect(result).not.toContain('TASKFLOW_NATAL');
});
it('accepts UTF-8 text, Markdown and the documented JSON shape without losing multiline content', () => {
  expect(parseNatalFile('chart.txt', '\uFEFF太陽：牡羊座\r\n月：天秤座')).toBe('太陽：牡羊座\n月：天秤座');
  expect(parseNatalFile('chart.md', '```md\n太陽：牡羊座\n```')).toBe('太陽：牡羊座');
  expect(parseNatalFile('chart.json', JSON.stringify({ natal: '太陽：牡羊座\n月：天秤座' }))).toBe('太陽：牡羊座\n月：天秤座');
});
it('rejects unsupported files, empty or malformed results and overlong content without truncating', () => {
  for (const [name, value] of [['chart.pdf', 'PDF'], ['chart.txt', ''], ['chart.json', 'no json'], ['chart.json', '{"natal":"x","userId":"other"}'], ['chart.json', '{"natal":7}'], ['chart.txt', 'x'.repeat(6001)], ['chart.txt', '\u0000bad'], ['chart.md', '<!-- TASKFLOW_NATAL_BEGIN -->oops']]) {
    expect(() => parseNatalFile(name, value)).toThrow();
  }
});
it('bounds file reads and rejects invalid encoding', async () => {
  const bytes = new TextEncoder().encode('太陽：牡羊座');
  await expect(readNatalFile({ name: 'natal.txt', size: bytes.length, arrayBuffer: async () => bytes.buffer })).resolves.toBe('太陽：牡羊座');
  const read = vi.fn();
  await expect(readNatalFile({ name: 'natal.txt', size: 65537, arrayBuffer: read })).rejects.toThrow('64KB');
  expect(read).not.toHaveBeenCalled();
  await expect(readNatalFile({ name: 'natal.txt', size: 2, arrayBuffer: async () => new Uint8Array([0xff, 0xff]).buffer })).rejects.toThrow('UTF-8');
});
