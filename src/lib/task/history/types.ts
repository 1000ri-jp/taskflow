export interface HistoryEntry {
  id: string;
  kind: 'activity' | 'comment' | 'meeting' | 'gmail' | 'chat';
  title: string;
  text: string;
  actor: string;
  /** Source event time, not the time when AI linked or inspected it. */
  at: string | null;
  recordedAt?: string | null;
  url?: string;
  private: boolean;
  sourceRef?: { operationId: string; ownerId: string };
  changes?: { field: string; before: string; after: string }[];
}
export interface TaskHistoryPage {
  entries: HistoryEntry[];
  nextCursor: string | null;
  checkedAt: string;
  activityStatus: 'ready' | 'error';
  issues: string[];
  privateSources?: {
    entries: HistoryEntry[];
    status: 'ready' | 'partial' | 'unavailable' | 'error';
    issues: string[];
    unavailableLinks: number;
  };
  mode?: 'mock';
}
