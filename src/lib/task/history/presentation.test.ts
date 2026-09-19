import { describe, expect, it } from 'vitest';
import { viewTask } from '@/test/taskViewFixtures';
import { safeHistoryUrl, sortHistory, taskSituation } from './presentation';
import type { HistoryEntry } from './types';
describe('task situation and provenance presentation', () => {
  it('keeps a shared wait visible with its resumption condition until explicitly resumed', () => {
    const task = viewTask({ workState: { status: 'wait', reason: '材料の見本待ち', resumeCondition: '見本が届き、色を確認する', reviewAt: '2026-09-21' } });
    expect(taskSituation(task, [task], {}, [])).toMatchObject({ situation: '待ち', next: '見本が届き、色を確認する' });
    expect(taskSituation({ ...task, isCompleted: true }, [task], {}, []).situation).toBe('完了');
  });
  it('names the person who can unblock the actual prerequisite', () => {
    const task = viewTask({ dependsOnTaskIds: ['approval'], assigneeIds: ['maker'] });
    const approval = viewTask({ id: 'approval', title: '校了', assigneeIds: ['reviewer'] });
    expect(taskSituation(task, [task, approval], { maker: '制作', reviewer: '確認担当' }, [])).toMatchObject({ situation: '前提の完了待ち（1件）', next: '確認担当：校了' });
  });
  it('does not infer readiness from a missing or cancelled prerequisite', () => {
    const task = viewTask({ dependsOnTaskIds: ['missing'] });
    expect(taskSituation(task, [task], {}, []).situation).toContain('確認できません');
    const cancelled = viewTask({ id: 'missing', isAbandoned: true });
    expect(taskSituation(task, [task, cancelled], {}, []).next).toContain('前提の見直し');
  });
  it('shows the pending reviewer and never completes a parent from children implicitly', () => {
    const task = viewTask();
    const review = viewTask({ id: 'review', parentTaskId: task.id, taskKind: 'review_request', title: '原稿確認', assigneeIds: ['u'] });
    expect(taskSituation(task, [task, review], { u: '梢' }, [])).toMatchObject({ situation: '返答・確認待ち（1件）', next: '梢：原稿確認' });
    expect(taskSituation(task, [task, { ...review, isCompleted: true }], {}, []).situation).toBe('未着手');
  });
  it('sorts by original event time instead of AI linkage time and deduplicates ids', () => {
    const meeting: HistoryEntry = { id: 'meeting', kind: 'meeting', title: '', text: '', actor: '', at: '2026-08-01T00:00:00Z', recordedAt: '2026-09-12T00:00:00Z', private: false };
    const comment = { ...meeting, id: 'comment', at: '2026-09-10T00:00:00Z', kind: 'comment' as const };
    expect(sortHistory([meeting, comment, meeting]).map(e => e.id)).toEqual(['comment', 'meeting']);
  });
  it('permits original comment and HTTPS links but blocks executable and deceptive destinations', () => {
    expect(safeHistoryUrl('#task-comment-c')).toBe('#task-comment-c');
    expect(safeHistoryUrl('https://mail.google.com/mail/#all/1')).toContain('https://mail.google.com');
    for (const url of ['javascript:alert(1)', '//evil.example', 'http://unsafe.example', 'https://user:pass@example.com']) expect(safeHistoryUrl(url)).toBeNull();
  });
});


it('exposes the same next work with stable assignee IDs for icons', () => {
 const parent = viewTask({ id: 'p', projectId: 'project', title: '全体', assigneeIds: ['maker'], dependsOnTaskIds: [] });
 const review = { ...parent, id: 'r', parentTaskId: 'p', title: '確認', taskKind: 'review_request', assigneeIds: ['reviewer'] } as import('@/types').Task;
 const state = taskSituation(parent, [parent, review], { reviewer: '確認担当' }, []);
 expect(state.next).toBe('確認担当：確認');
 expect(state.nextSteps).toEqual([{ assigneeIds: ['reviewer'], text: '確認' }]);
 expect(taskSituation({ ...parent, workState: { status: 'wait', reason: '', resumeCondition: '素材が届く', reviewAt: null } }, [parent], {}, []).nextSteps).toEqual([{ assigneeIds: null, text: '素材が届く' }]);
});
