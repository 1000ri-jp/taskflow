import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKUP_KEYS } from '@/lib/browser-backup';
import BrowserBackupPage from './page';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('browser backup page', () => {
  it('requires an explicit click, shows a snapshot, and never mutates storage', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(key => key === 'taskflow.upcomingRange.v1' ? '5' : null);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const clear = vi.spyOn(Storage.prototype, 'clear');
    render(<BrowserBackupPage />);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存内容を確認して書き出しを準備' }));
    expect(screen.getByRole('status')).toHaveTextContent('保存値 1件');
    expect(screen.getByRole('button', { name: 'JSONバックアップを保存' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('バックアップJSONを表示'));
    expect(screen.getByRole('region', { name: 'バックアップJSON' })).toHaveTextContent('taskflow.upcomingRange.v1');
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
  });
  it('reports blocked storage rather than presenting a successful empty backup', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<BrowserBackupPage />);
    fireEvent.click(screen.getByRole('button', { name: '保存内容を確認して書き出しを準備' }));
    expect(screen.getByRole('alert')).toHaveTextContent(`${BACKUP_KEYS.length}件`);
    expect(screen.getAllByText('読み取り失敗')).toHaveLength(BACKUP_KEYS.length);
  });
  it('downloads the snapshot in both formats and revokes temporary URLs', () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    const createObjectURL = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:backup-test');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const filenames: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filenames.push(this.download); });
    render(<BrowserBackupPage />);
    fireEvent.click(screen.getByRole('button', { name: '保存内容を確認して書き出しを準備' }));
    fireEvent.click(screen.getByRole('button', { name: 'JSONバックアップを保存' }));
    fireEvent.click(screen.getByRole('button', { name: '読みやすい一覧を保存' }));
    expect(filenames[0]).toMatch(/^taskflow-browser-backup-.*\.json$/);
    expect(filenames[1]).toMatch(/^taskflow-browser-backup-.*\.md$/);
    expect(createObjectURL.mock.calls[0][0].type).toBe('application/json;charset=utf-8');
    expect(createObjectURL.mock.calls[1][0].type).toBe('text/markdown;charset=utf-8');
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
