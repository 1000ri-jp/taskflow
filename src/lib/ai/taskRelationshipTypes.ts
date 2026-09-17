export interface TaskRelationshipSuggestion {
  id: string;
  kind: 'related' | 'parent_child' | 'merge';
  tasks: { id: string; title: string }[];
  parentTaskId: string | null;
  reason: string;
  evidence: { taskId: string; quote: string }[];
}

export interface TaskRelationshipReport {
  projectId: string;
  checkedAt: string;
  taskCount: number;
  suggestions: TaskRelationshipSuggestion[];
}
