import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrganizationLabTasks } from './useOrganizationLabTasks';
import { organizationMockKey, readOrganizationMock, requestOrganizationMock } from '@/lib/task/organizationMock';

import { MEETING_MOCK_PROJECTS, MULTI_PROGRESS_TASK_ID } from '@/lib/task/meetingMultiExample';
import type { OrganizationMultiAnalysis, OrganizationSource, OrganizationPreview } from '@/lib/task/organizationTypes';
import { webcrypto } from 'node:crypto';
const key = organizationMockKey('secretary-demo');
beforeEach(() => { MEETING_MOCK_PROJECTS.forEach(project => localStorage.removeItem(organizationMockKey(project.id)));
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('navigator', { locks: { request: async (_key: string, run: () => unknown) => run() } });
});
afterEach(() => { vi.unstubAllGlobals(); MEETING_MOCK_PROJECTS.forEach(project => localStorage.removeItem(organizationMockKey(project.id))); });

describe('isolated organization tasks in Neo', () => {
  it('never seeds a workbench or modifies existing secretary/browser drafts while reading', async () => {
    const draftKey = 'taskflow-secretary-lab-v1:e2e-mock-user';
    localStorage.setItem(draftKey, '{"existing":true}');
    const { result } = renderHook(() => useOrganizationLabTasks(true, 'e2e-mock-user'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.projects).toEqual([]); expect(result.current.tasks).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(draftKey)).toBe('{"existing":true}');
  });
  it('reads an explicitly saved workbench and follows adopted task changes without reloading', async () => {
    const saved = readOrganizationMock();
    saved.data.tasks['purchase-parent'].dueDate = new Date(2026, 8, 13);
    localStorage.setItem(key, JSON.stringify(saved));
    const { result, rerender } = renderHook(({ userId }) => useOrganizationLabTasks(true, userId), { initialProps: { userId: 'e2e-mock-user' } });
    await waitFor(() => expect(result.current.tasks).toHaveLength(3));
    expect(result.current.allProjectTasks).toHaveLength(4);
    expect(result.current.tasks.find(task => task.id === 'purchase-self')?.parentTitle).toContain('全員分');
    expect(result.current.tasks.find(task => task.id === 'purchase-parent')?.dueDate).toBeInstanceOf(Date);
    saved.data.tasks['purchase-self'].isCompleted = true;
    act(() => { localStorage.setItem(key, JSON.stringify(saved)); window.dispatchEvent(new Event('taskflow-work-updated')); });
    expect(result.current.tasks.some(task => task.id === 'purchase-self')).toBe(false);
    expect(result.current.allProjectTasks.find(task => task.id === 'purchase-self')?.isCompleted).toBe(true);
    rerender({ userId: 'unrelated-user' });
    expect(result.current.allProjectTasks).toEqual([]);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.projects).toEqual([]);
  });
  it('reports damaged saved data without deleting or overwriting it', async () => {
    localStorage.setItem(key, 'broken-json');
    const { result } = renderHook(() => useOrganizationLabTasks(true, 'e2e-mock-user'));
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
    expect(localStorage.getItem(key)).toBe('broken-json');
    expect(result.current.tasks).toEqual([]);
  });
});

it('shows both workbenches after explicit insertion, keeps equal ids scoped, and follows office adoption', async () => {
  const { result } = renderHook(() => useOrganizationLabTasks(true, 'e2e-mock-user'));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.projects).toEqual([]);
  const projectIds = MEETING_MOCK_PROJECTS.map(project => project.id);
  let source!: OrganizationSource;
  await act(async () => { source = await requestOrganizationMock({ action: 'example_many', projectIds }) as OrganizationSource; });
  await waitFor(() => expect(result.current.projects).toHaveLength(2));
  const matching = result.current.allProjectTasks.filter(task => task.id === MULTI_PROGRESS_TASK_ID);
  expect(matching.map(task => [task.projectId, task.title])).toEqual([['secretary-demo', '展示会の紹介文'], ['secretary-demo-office', '備品の見積もり確認']]);
  expect(result.current.tasks.some(task => task.projectId === 'secretary-demo-office')).toBe(false);
  const analysis = await requestOrganizationMock({ action: 'analyze_many', projectIds, source }) as OrganizationMultiAnalysis;
  const proposal = analysis.proposals.find(item => item.projectId === 'secretary-demo-office')!;
  await act(async () => {
    const preview = await requestOrganizationMock({ action: 'preview', projectId: proposal.projectId, source, draft: proposal.draft, basis: analysis.bases[proposal.projectId] }) as OrganizationPreview;
    await requestOrganizationMock({ action: 'apply', projectId: proposal.projectId, id: preview.id });
  });
  expect(result.current.allProjectTasks.find(task => task.id === MULTI_PROGRESS_TASK_ID && task.projectId === proposal.projectId)?.description).toContain('比較表はまだ作っていない');
  expect(result.current.allProjectTasks.find(task => task.id === MULTI_PROGRESS_TASK_ID && task.projectId === 'secretary-demo')?.description).not.toContain('比較表');
});
it('keeps accessible work from the other project when one saved workbench is damaged', async () => {
  const good = readOrganizationMock(); localStorage.setItem(key, JSON.stringify(good));
  const officeKey = organizationMockKey('secretary-demo-office'); localStorage.setItem(officeKey, 'broken-office');
  const { result } = renderHook(() => useOrganizationLabTasks(true, 'e2e-mock-user'));
  await waitFor(() => expect(result.current.error).toBeInstanceOf(Error));
  expect(result.current.allProjectTasks).toHaveLength(4);
  expect(result.current.projectTaskStatus.get('secretary-demo-office')?.status).toBe('error');
  expect(result.current.projectTaskStatus.get('secretary-demo')?.status).toBe('ready');
  expect(localStorage.getItem(officeKey)).toBe('broken-office');
});
