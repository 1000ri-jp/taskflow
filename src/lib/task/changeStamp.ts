/** Integration metadata is not a work edit or an optimistic-lock version. */
export const TASK_CHANGE_FIELD = 'apiChangedAt';
export const isTaskWritePath = (path: unknown) => typeof path === 'string' && /^projects\/[^/]+\/tasks(?:\/[^/]+)?$/.test(path);
