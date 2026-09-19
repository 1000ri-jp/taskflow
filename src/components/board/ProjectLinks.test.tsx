import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectLinks } from './ProjectLinks';

const urls = [{ id: 'a', title: '共有フォルダ', url: 'https://example.com/folder' }, { id: 'b', title: '参考資料', url: 'https://example.com/reference' }];
describe('project common links', () => {
  it('shows each link directly and leaves data unchanged when the editor is cancelled', () => {
    const update = vi.fn();
    render(<ProjectLinks urls={urls} onUpdate={update} />);
    expect(screen.getByRole('link', { name: '共有フォルダ' })).toHaveAttribute('href', urls[0].url);
    expect(screen.getByRole('link', { name: '参考資料' })).toHaveAttribute('href', urls[1].url);
    fireEvent.click(screen.getByRole('button', { name: 'リンクの追加・編集' }));
    expect(screen.getByRole('textbox', { name: '表示名' })).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }));
    expect(update).not.toHaveBeenCalled();
  });
  it('preserves other shared links when editing from the visible link', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    render(<ProjectLinks urls={urls} onUpdate={update} />);
    fireEvent.contextMenu(screen.getByRole('link', { name: '共有フォルダ' }));
    fireEvent.change(screen.getByRole('textbox', { name: '表示名' }), { target: { value: '出展資料' } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith([{ ...urls[0], title: '出展資料' }, urls[1]]));
  });
  it('adds a named URL and keeps failed edits available for retry', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    render(<ProjectLinks urls={[]} onUpdate={update} />);
    fireEvent.click(screen.getByRole('button', { name: 'リンクを設定' }));
    fireEvent.change(screen.getByRole('textbox', { name: '表示名' }), { target: { value: '新資料' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'URL' }), { target: { value: 'https://example.com/new' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
    expect(screen.getByRole('textbox', { name: '表示名' })).toHaveValue('新資料');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(update).toHaveBeenLastCalledWith([{ id: expect.any(String), title: '新資料', url: 'https://example.com/new' }]);
  });
  it('does not render executable URLs as links and rejects them on save', () => {
    const update = vi.fn();
    render(<ProjectLinks urls={[{ id: 'bad', title: '不正URL', url: 'javascript:alert(1)' }]} onUpdate={update} />);
    expect(screen.queryByRole('link', { name: '不正URL' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'リンクの追加・編集' }));
    fireEvent.change(screen.getByRole('combobox', { name: '編集するリンク' }), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('https://');
    expect(update).not.toHaveBeenCalled();
  });
});
