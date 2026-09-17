import { describe, expect, it } from 'vitest';
import { projectViewHref, rememberedTaskView } from './projectNavigation';
import { resolveTaskView } from './taskViews';

describe('project view navigation', () => {
  it('roundtrips task format, list, task and comment through calendar and gantt', () => {
    const initial = new URLSearchParams('view=outline&list=show&task=child&comment=source');
    const calendar = new URL(projectViewHref('p', 'calendar', initial), 'http://localhost');
    expect(calendar.pathname).toBe('/projects/p/board');
    const gantt = new URL(projectViewHref('p', 'gantt', calendar.searchParams), 'http://localhost');
    expect(gantt.pathname).toBe('/projects/p/gantt');
    expect(gantt.searchParams.get('view')).toBeNull();
    const back = new URL(projectViewHref('p', rememberedTaskView(gantt.searchParams, 'calendar'), gantt.searchParams), 'http://localhost');
    expect(Object.fromEntries(back.searchParams)).toEqual({ view: 'outline', taskView: 'outline', list: 'show', task: 'child', comment: 'source' });
  });
  it('honors existing calendar defaults and explicit legacy links', () => {
    expect(resolveTaskView(null, 'calendar')).toBe('calendar');
    expect(resolveTaskView('table', 'calendar')).toBe('table');
    expect(rememberedTaskView(new URLSearchParams(), 'calendar')).toBe('board');
    expect(rememberedTaskView(new URLSearchParams('taskView=unknown'), 'table')).toBe('table');
  });
});
