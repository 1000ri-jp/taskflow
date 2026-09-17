import { describe, expect, it } from 'vitest';
import type { GoogleItem } from '@/lib/google/workspace/types';
import type { DashboardTask } from './brief';
import { buildNeoCalendarDays } from './neo-calendar';

const date = (day: number, hour = 0, minute = 0) => new Date(2026, 8, day, hour, minute);
const now = date(12, 14);

function task(overrides: Partial<DashboardTask> = {}): DashboardTask {
  return {
    id: 'task', projectId: 'project', projectName: '案件', listId: 'list', title: '仕事', description: '', order: 0,
    assigneeIds: ['user'], labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null,
    dueDate: date(12), durationDays: null, isDueDateFixed: false, isCompleted: false, completedAt: null,
    isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null, createdBy: 'user',
    createdAt: date(1), updatedAt: date(11), ...overrides,
  };
}

function event(overrides: Partial<GoogleItem> = {}): GoogleItem {
  return {
    id: 'event', title: '予定', text: '', at: date(12, 10).toISOString(), end: date(12, 11).toISOString(),
    url: 'https://calendar.google.com/', sourceName: '仕事', ...overrides,
  };
}

describe('buildNeoCalendarDays', () => {
  it('includes today through the fifth or seventh day, preserving empty days and midnight boundaries', () => {
    const tasks = [task({ id: 'sixth', dueDate: date(17) }), task({ id: 'seventh', dueDate: date(18, 23, 59) }), task({ id: 'outside', dueDate: date(19) })];
    expect(buildNeoCalendarDays(tasks, [], now, 5)).toEqual([12, 13, 14, 15, 16].map(day => ({ date: date(day), tasks: [], events: [] })));
    const days = buildNeoCalendarDays(tasks, [], now, 7);
    expect(days.map(day => day.date)).toEqual([12, 13, 14, 15, 16, 17, 18].map(day => date(day)));
    expect(days.map(day => day.tasks.map(item => item.id))).toEqual([[], [], [], [], [], ['sixth'], ['seventh']]);
  });

  it('uses active task due dates only, regardless of start dates or fixed-date flags', () => {
    const tasks = [
      task({ id: 'due-today', startDate: date(10) }),
      task({ id: 'due-tomorrow', startDate: date(12), dueDate: date(13), isDueDateFixed: true }),
      task({ id: 'only-start', startDate: date(12), dueDate: null }),
      task({ id: 'overdue', dueDate: date(11, 23, 59) }),
      task({ id: 'completed', isCompleted: true }), task({ id: 'archived', isArchived: true }), task({ id: 'abandoned', isAbandoned: true }),
    ];
    expect(buildNeoCalendarDays(tasks, [], now, 5).map(day => day.tasks.map(item => item.id))).toEqual([['due-today'], ['due-tomorrow'], [], [], []]);
  });

  it('sorts tasks by priority, then due time, then title without changing their order fields', () => {
    const tasks = [
      task({ id: 'none', priority: null }), task({ id: 'low', priority: 'low' }), task({ id: 'medium', priority: 'medium' }),
      task({ id: 'late', priority: 'high', dueDate: date(12, 20), order: 9 }),
      task({ id: 'b', title: 'B', priority: 'high', dueDate: date(12, 9) }), task({ id: 'a', title: 'A', priority: 'high', dueDate: date(12, 9) }),
    ];
    const result = buildNeoCalendarDays(tasks, [], now, 5)[0].tasks;
    expect(result.map(item => item.id)).toEqual(['a', 'b', 'late', 'medium', 'low', 'none']);
    expect(result.find(item => item.id === 'late')?.order).toBe(9);
  });

  it('shows multi-day all-day events through the day before their exclusive end', () => {
    const events = [event({ allDay: true, at: date(11).toISOString(), end: date(14).toISOString() })];
    expect(buildNeoCalendarDays([], events, now, 5).map(day => day.events.length)).toEqual([1, 1, 0, 0, 0]);
  });

  it('includes timed events on each overlapping day and excludes an exact midnight end', () => {
    const events = [
      event({ id: 'overnight', at: date(12, 23).toISOString(), end: date(13, 1).toISOString() }),
      event({ id: 'midnight-end', at: date(13, 20).toISOString(), end: date(14).toISOString() }),
      event({ id: 'already-ended', at: date(11, 23).toISOString(), end: date(12).toISOString() }),
      event({ id: 'starts-midnight', at: date(14).toISOString(), end: date(14, 1).toISOString() }),
    ];
    expect(buildNeoCalendarDays([], events, now, 5).map(day => day.events.map(item => item.id))).toEqual([
      ['overnight'], ['overnight', 'midnight-end'], ['starts-midnight'], [], [],
    ]);
  });

  it('shows an event without an end only on its start day', () => {
    const events = [event({ end: undefined }), event({ id: 'old', at: date(11).toISOString(), end: undefined, allDay: true })];
    expect(buildNeoCalendarDays([], events, now, 5).map(day => day.events.map(item => item.id))).toEqual([['event'], [], [], [], []]);
  });

  it('skips invalid dates and invalid or empty intervals without throwing', () => {
    const tasks = [task({ dueDate: new Date('invalid') })];
    const events = [
      event({ at: 'invalid' }), event({ end: 'invalid' }), event({ end: date(12, 9).toISOString() }), event({ end: date(12, 10).toISOString() }),
    ];
    expect(buildNeoCalendarDays(tasks, events, now, 5).every(day => !day.tasks.length && !day.events.length)).toBe(true);
    expect(buildNeoCalendarDays([], [], new Date('invalid'), 5)).toEqual([]);
  });

  it('places all-day events first, then timed events by start time and title', () => {
    const events = [
      event({ id: 'late', at: date(12, 15).toISOString(), end: date(12, 16).toISOString() }),
      event({ id: 'b', title: 'B' }), event({ id: 'a', title: 'A' }),
      event({ id: 'all-day', allDay: true, at: date(12).toISOString(), end: date(13).toISOString() }),
      event({ id: 'ongoing', at: date(11, 23).toISOString(), end: date(12, 9).toISOString() }),
    ];
    expect(buildNeoCalendarDays([], events, now, 5)[0].events.map(item => item.id)).toEqual(['all-day', 'ongoing', 'a', 'b', 'late']);
  });

  it('omits only explicit home-office working locations and does not infer event types from titles or partial metadata', () => {
    const events = [
      event({ id: 'home-office', title: '自宅勤務', eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice' }, allDay: true, at: date(11).toISOString(), end: date(18).toISOString() }),
      event({ id: 'renamed-home-office', title: '別の表示名', eventType: 'workingLocation', workingLocationProperties: { type: 'homeOffice' } }),
      event({ id: 'home-title-only', title: '自宅' }),
      event({ id: 'normal-event', title: '自宅', eventType: 'default' }),
      event({ id: 'non-working-location', eventType: 'default', workingLocationProperties: { type: 'homeOffice' } }),
      event({ id: 'missing-event-type', workingLocationProperties: { type: 'homeOffice' } }),
      event({ id: 'missing-properties', eventType: 'workingLocation' }),
      event({ id: 'missing-location-type', eventType: 'workingLocation', workingLocationProperties: {} }),
      event({ id: 'office', eventType: 'workingLocation', workingLocationProperties: { type: 'officeLocation' } }),
      event({ id: 'custom', eventType: 'workingLocation', workingLocationProperties: { type: 'customLocation' } }),
    ];
    const days = buildNeoCalendarDays([], events, now, 5);
    expect(days[0].events.map(item => item.id).sort()).toEqual(events.slice(2).map(item => item.id).sort());
    expect(days.slice(1).every(day => day.events.length === 0)).toBe(true);
  });

  it('preserves the input arrays, objects, titles, and dates', () => {
    const sourceTask = Object.freeze(task({ title: '仕事の原文', order: 7 }));
    const sourceEvent = Object.freeze(event({ title: '予定の原文' }));
    const tasks = Object.freeze([sourceTask]);
    const sourceHomeOffice = Object.freeze(event({ id: 'home-office', title: '自宅勤務', eventType: 'workingLocation', workingLocationProperties: Object.freeze({ type: 'homeOffice' }) }));
    const events = Object.freeze([sourceEvent, sourceHomeOffice]);
    const originalTime = now.getTime();
    const days = buildNeoCalendarDays(tasks, events, now, 5);
    expect(days[0].tasks[0]).toBe(sourceTask);
    expect(days[0].events[0]).toBe(sourceEvent);
    expect(now.getTime()).toBe(originalTime);
    expect(days[0].date).not.toBe(now);
    expect(tasks).toEqual([sourceTask]);
    expect(events).toEqual([sourceEvent, sourceHomeOffice]);
    expect(sourceHomeOffice.workingLocationProperties).toEqual({ type: 'homeOffice' });
    expect(days.flatMap(day => day.events)).not.toContain(sourceHomeOffice);
  });
});
