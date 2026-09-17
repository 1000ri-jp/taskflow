import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TaskCreationForm } from './TaskCreationForm';
const state = vi.hoisted(() => ({ loading: false, error: null as Error | null, main: 'main' }));
vi.mock('@/hooks/useProjects', () => ({ useProject: () => ({ project: { id: 'p', memberIds: ['main','other'], defaultAssigneeId: state.main }, isLoading: state.loading, error: state.error }) }));
vi.mock('@/hooks/useMeetingMembers', () => ({ useMeetingMembers: () => ({ users: [{id:'main',displayName:'主担当さん'},{id:'other',displayName:'別の担当さん'}], isLoading:false,hasError:false }) }));
beforeEach(() => { state.loading = false; state.error = null; state.main = 'main'; });
it('shows the default without an extra confirmation and retains explicit unassignment through failure and retry', async () => {
  const submit = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValueOnce('id'); const close = vi.fn();
  render(<TaskCreationForm projectId="p" onSubmit={submit} onCancel={close} />);
  expect(screen.getByText('担当：主担当さん')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'長い日本語の作業名・確認してから提出する'}});
  fireEvent.click(screen.getByText('担当：主担当さん'));
  fireEvent.click(screen.getByRole('button',{name:'担当未設定にする'}));
  fireEvent.submit(screen.getByRole('form')); expect(await screen.findByRole('alert')).toHaveTextContent('保存失敗');
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole('textbox')).toHaveValue('長い日本語の作業名・確認してから提出する');
  fireEvent.submit(screen.getByRole('form')); await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(submit.mock.calls).toEqual([['長い日本語の作業名・確認してから提出する',[]],['長い日本語の作業名・確認してから提出する',[]]]);
});
it('blocks duplicate saves and does not replace an unassigned parent with the project default', async () => {
  let finish!: () => void; const submit=vi.fn(() => new Promise<void>(resolve => { finish=resolve; }));
  render(<TaskCreationForm projectId="p" parent={{assigneeIds:[]}} onSubmit={submit} onCancel={vi.fn()} />);
  expect(screen.getByText('担当：担当未設定')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'子作業'}}); fireEvent.submit(screen.getByRole('form')); fireEvent.submit(screen.getByRole('form'));
  expect(submit).toHaveBeenCalledExactlyOnceWith('子作業',[]); await act(async () => finish());
});
it('uses the selected list default ahead of the project default for new work', async () => {
  const submit = vi.fn();
  render(<TaskCreationForm projectId="p" listDefaultAssigneeId="other" onSubmit={submit} onCancel={vi.fn()} />);
  expect(screen.getByText('担当：別の担当さん')).toBeInTheDocument();
  expect(screen.getByText('（リストの主担当）')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '列の仕事' } });
  fireEvent.submit(screen.getByRole('form'));
  await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith('列の仕事', ['other']));
});
it('keeps input and disables creation when fetching the project fails', () => {
  const submit=vi.fn(); const {rerender}=render(<TaskCreationForm projectId="p" onSubmit={submit} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'保持する'}}); state.error=new Error('offline'); rerender(<TaskCreationForm projectId="p" onSubmit={submit} onCancel={vi.fn()} />);
  expect(screen.getByRole('alert')).toHaveTextContent('取得できません'); expect(screen.getByRole('textbox')).toHaveValue('保持する'); fireEvent.submit(screen.getByRole('form')); expect(submit).not.toHaveBeenCalled();
});
