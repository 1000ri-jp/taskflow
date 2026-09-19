import { isTaskView, type TaskView } from './taskViews';

export type ProjectView = TaskView | 'gantt';
export const isProjectView = (value: unknown): value is ProjectView => value === 'gantt' || isTaskView(value);
export const resolveProjectView = (urlView: unknown, saved: unknown): ProjectView => isProjectView(urlView) ? urlView : isProjectView(saved) ? saved : 'board';

export function rememberedTaskView(params: URLSearchParams, primaryView: ProjectView): Exclude<TaskView, 'calendar'> {
  const value = params.get('taskView') ?? params.get('view');
  return isTaskView(value) && value !== 'calendar' ? value : isTaskView(primaryView) && primaryView !== 'calendar' ? primaryView : 'board';
}

export function projectViewHref(projectId: string, nextView: ProjectView, params: URLSearchParams, primaryView: ProjectView = 'board') {
  const next = new URLSearchParams(params);
  next.set('taskView', nextView === 'calendar' || nextView === 'gantt' ? rememberedTaskView(params, primaryView) : nextView);
  if (nextView === 'gantt') next.delete('view');
  else next.set('view', nextView);
  return `/projects/${projectId}/${nextView === 'gantt' ? 'gantt' : 'board'}?${next}`;
}
