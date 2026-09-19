import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NatalReferenceField } from './NatalReferenceField';
const fake = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/ai/support/natalImport', () => ({ NATAL_FILE_ACCEPT: '.txt,.md,.json', NATAL_TEMPLATE_URL: '/templates/taskflow-natal-template.md', readNatalFile: fake.read }));
function Form() { const [text, setText] = useState('前の結果'); return <NatalReferenceField value={text} onChange={setText} />; }
const choose = () => fireEvent.change(screen.getByLabelText('ネイタルのファイル'), { target: { files: [new File(['x'], 'chart.md', { type: 'text/markdown' })] } });
beforeEach(() => { vi.resetAllMocks(); fake.read.mockResolvedValue('取り込んだ結果'); });
it('imports into the editable draft, offers the sample download, and restores the previous text', async () => {
  render(<Form />);
  expect(screen.getByRole('link', { name: '記入用サンプル' })).toHaveAttribute('download', 'taskflow-natal-template.md');
  choose();
  await waitFor(() => expect(screen.getByLabelText('ネイタルの結果')).toHaveValue('取り込んだ結果'));
  expect(screen.getByRole('status')).toHaveTextContent('保存で反映');
  fireEvent.click(screen.getByRole('button', { name: '取り込みを戻す' }));
  expect(screen.getByLabelText('ネイタルの結果')).toHaveValue('前の結果');
});
it('keeps the existing draft when reading fails', async () => {
  fake.read.mockRejectedValue(new Error('読み込めません')); render(<Form />); choose();
  expect(await screen.findByRole('alert')).toHaveTextContent('読み込めません');
  expect(screen.getByLabelText('ネイタルの結果')).toHaveValue('前の結果');
});
it('does not replace text changed while a file was being read', async () => {
  let resolve!: (text: string) => void;
  fake.read.mockReturnValue(new Promise<string>(done => { resolve = done; }));
  const change = vi.fn(); const ui = render(<NatalReferenceField value="前の結果" onChange={change} />); choose();
  ui.rerender(<NatalReferenceField value="別の入力" onChange={change} />);
  await act(async () => resolve('古い読込結果'));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('入力が変わった');
});
