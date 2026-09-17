import { expect, it } from 'vitest';
import { resolveTaskAssignees } from './assigneeDefaults';
import { planAssigneeBackfill } from './assigneeBackfill';
import { planOrganization } from './organizationEngine';

it.each([
  [{ explicit: ['exception'], parent: { assigneeIds: ['parent'] }, defaultAssigneeId: 'main' }, ['exception']],
  [{ explicit: [], parent: { assigneeIds: ['parent'] }, defaultAssigneeId: 'main' }, []],
  [{ parent: { assigneeIds: ['parent'] }, defaultAssigneeId: 'main' }, ['parent']],
  [{ parent: { assigneeIds: [] }, defaultAssigneeId: 'main' }, []],
  [{ defaultAssigneeId: 'main', memberIds: ['main'] }, ['main']],
  [{ defaultAssigneeId: 'project', listDefaultAssigneeId: 'list', memberIds: ['project', 'list'] }, ['list']],
  [{ defaultAssigneeId: 'project', listDefaultAssigneeId: 'departed', memberIds: ['project', 'list'] }, ['project']],
  [{ defaultAssigneeId: 'left', memberIds: ['main'] }, []],
  [{}, []],
])('resolves creation precedence without mutating inputs: %j', (input, expected) => {
  const before = structuredClone(input); expect(resolveTaskAssignees(input)).toEqual(expected); expect(input).toEqual(before);
});
it('shares defaults with memo previews, while a parent and explicit empty assignment take precedence', () => {
  const data = { defaultAssigneeId: 'main', memberIds: ['main', 'parent'], listIds: ['list'], tasks: { parent: { title: '制作', listId: 'list', assigneeIds: ['parent'] } }, children: {} };
  const draft = { kind: 'create' as const, taskIds: [], title: '新規作業', reason: '依頼', quote: '作る' };
  const source = { kind: 'manual' as const, id: 'source', title: 'メモ', text: '作る', occurredAt: null };
  const create = (override: object) => planOrganization(data, 'p', 'main', 'new', source, { ...draft, ...override }, '2026-09-16T00:00:00Z').writes[0].after.assigneeIds;
  expect(create({})).toEqual(['main']); expect(create({ targetTaskId: 'parent' })).toEqual(['parent']); expect(create({ assigneeIds: [] })).toEqual([]);
});
it('requires a reviewed selection and rejects stale backfills before any patch', () => {
  const tasks = { a: { assigneeIds: [] }, b: { assigneeIds: ['other'] }, c: { assigneeIds: [], isCompleted: true } };
  expect(planAssigneeBackfill(tasks, ['a'], 'main', 'main', ['main'])).toEqual([{ id: 'a', assigneeIds: ['main'] }]);
  expect(() => planAssigneeBackfill(tasks, ['a','b'], 'main', 'main', ['main'])).toThrow('変更');
  expect(() => planAssigneeBackfill(tasks, ['c'], 'main', 'main', ['main'])).toThrow('変更');
  expect(() => planAssigneeBackfill(tasks, ['a'], 'main', 'new', ['main','new'])).toThrow('主担当');
  expect(tasks.a.assigneeIds).toEqual([]);
});
