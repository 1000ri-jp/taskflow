import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { useAISettingsStore } from '@/stores/aiSettingsStore';
import type { TaskRelationshipReport } from '@/lib/ai/taskRelationshipTypes';
import { TaskRelationshipSuggestions } from './TaskRelationshipSuggestions';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/lib/ai/taskRelationshipClient', () => ({ requestTaskRelationships: request }));

const tasks = [viewTask({ id: 'parent', title: '天然石セット販売' }), viewTask({ id: 'child', title: '天然石ブレスレット' })];
const report: TaskRelationshipReport = {
  projectId: 'project-1', checkedAt: '2026-09-12T03:00:00.000Z', taskCount: 2,
  suggestions: [{
    id: 'candidate-1', kind: 'parent_child', tasks: tasks.map(({ id, title }) => ({ id, title })),
    parentTaskId: 'parent', reason: '同じ販売準備として、セット販売の下にまとめる候補です。',
    evidence: [{ taskId: 'parent', quote: '天然石セット販売' }, { taskId: 'child', quote: '天然石ブレスレット' }],
  }],
};
const deferred = () => {
  let resolve!: (value: TaskRelationshipReport) => void;
  const promise = new Promise<TaskRelationshipReport>(done => { resolve = done; });
  return { promise, resolve };
};
const trigger = () => screen.getByRole('button', { name: '関連・まとめ候補を探す' });

describe('project task relationship suggestions', () => {
  beforeEach(() => {
    request.mockReset();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    useAISettingsStore.setState({ provider: 'gemini', geminiModel: 'configured-model' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('only scans on request, shows the reason and source, and opens the selected task for review', async () => {
    const response = deferred();
    request.mockReturnValue(response.promise);
    const openTask = vi.fn();
    render(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={openTask} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(trigger());
    expect(request).toHaveBeenCalledExactlyOnceWith('project-1', 'gemini', 'configured-model', expect.any(AbortSignal));
    expect(screen.getByRole('status')).toHaveTextContent('タスクを照合しています');
    await act(async () => response.resolve(report));
    const dialog = screen.getByRole('dialog', { name: '関連・まとめ候補' });
    expect(within(dialog).getByText(report.suggestions[0].reason)).toBeVisible();
    expect(within(dialog).getByText('親子の候補')).toBeVisible();
    fireEvent.click(within(dialog).getByText('根拠'));
    expect(within(dialog).getByText('「天然石ブレスレット」')).toBeVisible();
    expect(openTask).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '天然石ブレスレット' }));
    expect(openTask).toHaveBeenCalledExactlyOnceWith('child');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('distinguishes unavailable results from no candidates and allows retry', async () => {
    request.mockRejectedValueOnce(new Error('AIが参照できるプロジェクトに含まれていません。'));
    request.mockResolvedValueOnce({ ...report, suggestions: [] });
    render(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={vi.fn()} />);
    fireEvent.click(trigger());
    expect(await screen.findByRole('alert')).toHaveTextContent('AIが参照できるプロジェクトに含まれていません。');
    expect(screen.queryByText(/見つかりませんでした/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI設定を開く' })).toHaveAttribute('href', '/settings/ai');
    fireEvent.click(screen.getByRole('button', { name: 'もう一度試す' }));
    expect(await screen.findByText('今回の情報では、関連・まとめ候補は見つかりませんでした。')).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cancels on close and ignores a late response, with a fresh scan on reopening', async () => {
    const response = deferred();
    request.mockReturnValueOnce(response.promise).mockResolvedValueOnce({ ...report, suggestions: [] });
    render(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={vi.fn()} />);
    fireEvent.click(trigger());
    const signal = request.mock.calls[0][3] as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(signal.aborted).toBe(true);
    await act(async () => response.resolve(report));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger());
    expect(await screen.findByText(/今回の情報では/)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(report.suggestions[0].reason)).not.toBeInTheDocument();
  });

  it('returns keyboard focus on normal close and reuses a current result', async () => {
    const user = userEvent.setup();
    request.mockResolvedValue(report);
    render(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={vi.fn()} />);
    const button = trigger();
    act(() => button.focus());
    await user.keyboard('{Enter}');
    await screen.findByText(report.suggestions[0].reason);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(await screen.findByText(report.suggestions[0].reason)).toBeVisible();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('marks results stale after a task changes and blocks opening removed tasks', async () => {
    request.mockResolvedValue(report);
    const props = { projectId: 'project-1', onTaskClick: vi.fn() };
    const { rerender } = render(<TaskRelationshipSuggestions {...props} tasks={tasks} />);
    fireEvent.click(trigger());
    await screen.findByText(report.suggestions[0].reason);
    rerender(<TaskRelationshipSuggestions {...props} tasks={[tasks[0]]} />);
    expect(screen.getByRole('status')).toHaveTextContent('タスクが更新されました');
    expect(screen.getByRole('button', { name: '天然石ブレスレット' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(trigger());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });

  it('cancels when its project or user context unmounts and does not scan while disabled', () => {
    request.mockReturnValue(deferred().promise);
    const { rerender, unmount } = render(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={vi.fn()} disabled />);
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(request).not.toHaveBeenCalled();
    rerender(<TaskRelationshipSuggestions projectId="project-1" tasks={tasks} onTaskClick={vi.fn()} />);
    fireEvent.click(trigger());
    const signal = request.mock.calls[0][3] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
