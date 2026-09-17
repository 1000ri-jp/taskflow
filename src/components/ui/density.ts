/** Shared display roles. Do not shrink prose or form controls to fit a row. */
export const compactCell = 'tf-compact-cell';
export const compactRow = 'tf-compact-row';
export const taskRowHoverState = 'hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring';
export const taskRowInteraction = 'transition-colors ' + taskRowHoverState;
export const taskCardInteraction = 'transition-[background-color,box-shadow] ' + taskRowHoverState;
export const taskTitle = 'tf-task-title min-w-0 flex-1 break-words rounded-md text-left font-medium ' + taskRowInteraction;
