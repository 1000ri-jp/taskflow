import { describe, expect, it } from 'vitest';
import { parseWorkBlocks, scheduledWork, workBlockError } from './work-blocks';
import { viewTask } from '@/test/taskViewFixtures';
const block = { id: '1', taskId: 'task-1', projectId: 'project-1', start: '2026-09-15T01:00:00Z', end: '2026-09-15T02:00:00Z' };
describe('scheduled work', () => {
  it('uses explicit reservations only, keeps deadlines intact, and never joins tasks across projects', () => {
    const dueDate = new Date(2026, 8, 18);
    const task = { ...viewTask({ dueDate, startDate: new Date(2026, 8, 15) }), projectName: 'Project' };
    expect(scheduledWork([task], [])).toEqual([]);
    expect(scheduledWork([{ ...task, projectId: 'different' }], [block])).toEqual([]);
    expect(scheduledWork([task], [block])[0].event).toMatchObject({ at: block.start, end: block.end, eventType: 'taskflowWork' });
    expect(task.dueDate).toEqual(dueDate);
    expect(scheduledWork([{ ...task, isCompleted: true }], [block])).toEqual([]);
    expect(scheduledWork([{ ...task, isArchived: true }], [block])).toEqual([]);
  });
  it('rejects invalid or oversized reservations and malformed saved data', () => {
    expect(workBlockError({ ...block, start: 'invalid' })).not.toBeNull();
    expect(workBlockError({ ...block, end: '2026-09-17T01:00:00Z' })).not.toBeNull();
    expect(() => parseWorkBlocks('{"start":"bad"}')).toThrow();
    expect(() => parseWorkBlocks('[null]')).toThrow();
  });
});
