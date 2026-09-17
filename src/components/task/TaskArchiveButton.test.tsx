import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskArchiveButton } from './TaskArchiveButton';
import { acknowledgeArchive, hasAcknowledgedArchive } from '@/lib/archiveNotice';
import { archiveTask } from '@/lib/firebase/firestore';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());
vi.mock('@/lib/firebase/firestore',()=>({archiveTask:vi.fn()}));
describe('TaskArchiveButton',()=>{
  beforeEach(()=>{ vi.resetAllMocks(); localStorage.clear(); });
  const renderButton=(onArchived=vi.fn())=>render(<TaskArchiveButton projectId="p" taskId="t" taskTitle="対象タスク" userId="u" onArchived={onArchived}/>);
  it('does not archive on open or cancel and explains restoration',()=>{
    renderButton();
    const button=screen.getByRole('button',{name:'タスクをアーカイブ'});
    expect(button).toHaveTextContent(/^$/);
    expect(button).toBeVisible();
    fireEvent.click(button);
    expect(screen.getByText(/設定.*アーカイブ済みタスク/)).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));
    expect(archiveTask).not.toHaveBeenCalled();
  });
  it('archives only the target after confirmation, prevents repeat submits and closes after success',async()=>{
    let resolve!:()=>void;vi.mocked(archiveTask).mockReturnValue(new Promise(done=>{resolve=done;}));
    const onArchived=vi.fn();renderButton(onArchived);
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    fireEvent.click(screen.getByRole('button',{name:'アーカイブする'}));
    expect(archiveTask).toHaveBeenCalledExactlyOnceWith('p','t','u');
    expect(screen.getByRole('button',{name:'処理中…'})).toBeDisabled();
    expect(onArchived).not.toHaveBeenCalled();
    await act(async()=>resolve());
    expect(onArchived).toHaveBeenCalledTimes(1);
  });
  it('keeps the confirmation open on failure and supports retry',async()=>{
    vi.mocked(archiveTask).mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(undefined);
    const onArchived=vi.fn();renderButton(onArchived);fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    fireEvent.click(screen.getByRole('button',{name:'アーカイブする'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('アーカイブできません');
    expect(onArchived).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'アーカイブする'}));
    await waitFor(()=>expect(onArchived).toHaveBeenCalledTimes(1));
  });
  it('skips subsequent confirmation after a successful first archive across tasks for the same user', async()=>{
    vi.mocked(archiveTask).mockResolvedValue(undefined);
    const {unmount}=renderButton();
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    fireEvent.click(screen.getByRole('button',{name:'アーカイブする'}));
    await waitFor(()=>expect(hasAcknowledgedArchive('u','task')).toBe(true));
    expect(hasAcknowledgedArchive('u','project')).toBe(false);
    expect(hasAcknowledgedArchive('someone-else','task')).toBe(false);
    unmount();
    const onArchived=vi.fn();
    render(<TaskArchiveButton projectId="p2" taskId="t2" taskTitle="次のタスク" userId="u" onArchived={onArchived}/>);
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    await waitFor(()=>expect(onArchived).toHaveBeenCalledOnce());
    expect(archiveTask).toHaveBeenLastCalledWith('p2','t2','u');
    expect(screen.queryByRole('button',{name:'アーカイブする'})).not.toBeInTheDocument();
  });
  it('retains the notice after cancellation or failure, and exposes retry on a later direct failure',async()=>{
    vi.mocked(archiveTask).mockRejectedValue(new Error('network'));
    renderButton();
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));
    expect(hasAcknowledgedArchive('u','task')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    fireEvent.click(screen.getByRole('button',{name:'アーカイブする'}));
    await screen.findByRole('alert');
    expect(hasAcknowledgedArchive('u','task')).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'キャンセル'}));
    acknowledgeArchive('u','task');
    fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('アーカイブできません');
    expect(screen.getByRole('button',{name:'アーカイブする'})).toBeEnabled();
  });

});
