import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskArchiveButton } from './TaskArchiveButton';
import { archiveTask } from '@/lib/firebase/firestore';
vi.mock('@/lib/firebase/firestore',()=>({archiveTask:vi.fn()}));
describe('TaskArchiveButton',()=>{
  beforeEach(()=>vi.resetAllMocks());
  const renderButton=(onArchived=vi.fn())=>render(<TaskArchiveButton projectId="p" taskId="t" taskTitle="対象タスク" userId="u" onArchived={onArchived}/>);
  it('does not archive on open or cancel and explains restoration',()=>{
    renderButton();fireEvent.click(screen.getByRole('button',{name:'タスクをアーカイブ'}));
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
});
