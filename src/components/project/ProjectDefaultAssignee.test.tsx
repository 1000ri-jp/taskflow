import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectDefaultAssignee } from './ProjectDefaultAssignee';
import type { Project } from '@/types';
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{id:'u',displayName:'本人'},{id:'v',displayName:'同僚'}], isLoading:false, hasError:false }) }));
vi.mock('./ProjectAssigneeBackfill', () => ({ ProjectAssigneeBackfill: () => <p>既存の担当未設定タスクへ適用</p> }));
const project = {id:'p',memberIds:['u','v'],defaultAssigneeId:null} as Project;
describe('project creation default', () => {
  it('keeps the chosen default after failure, retries, and reads the saved value on remount', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValue(undefined);
    const view = render(<ProjectDefaultAssignee project={project} canEdit onSave={save} />);
    fireEvent.change(screen.getByRole('combobox'), {target:{value:'v'}});
    fireEvent.click(screen.getByRole('button',{name:'主担当を保存'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存失敗');
    expect(screen.getByRole('combobox')).toHaveValue('v');
    fireEvent.click(screen.getByRole('button',{name:'主担当を保存'}));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenLastCalledWith({defaultAssigneeId:'v'});
    expect(await screen.findByRole('status')).toHaveTextContent('次の新規タスク');
    view.unmount();
    render(<ProjectDefaultAssignee project={{...project,defaultAssigneeId:'v'}} canEdit onSave={save} />);
    expect(screen.getByRole('combobox')).toHaveValue('v');
    expect(save).toHaveBeenCalledTimes(2);
  });
  it('keeps a viewer read-only', () => {
    render(<ProjectDefaultAssignee project={project} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('button',{name:'主担当を保存'})).toBeDisabled();
  });
});
