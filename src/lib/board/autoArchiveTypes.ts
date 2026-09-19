export interface AutoArchiveCandidate {
  id: string;
  title: string;
  listName: string;
  completedAt: string;
  elapsedDays: number;
}

export interface AutoArchiveView {
  projectId: string | null;
  revision: string;
  mode: 'inherit' | 'custom';
  days: number | null;
  defaultDays: number | null;
  effectiveDays: number | null;
  configured: boolean;
  canEdit: boolean;
  scopeLabel: string;
  backgroundConfigured: boolean;
  asOf: string;
  preview: {
    candidates: AutoArchiveCandidate[];
    waitingCount: number;
    missingDateCount: number;
    protectedCount: number;
    restoredCount: number;
  } | null;
  lastRun: { at: string; archivedCount: number; error: string | null } | null;
}

export interface AutoArchiveSave {
  projectId: string | null;
  revision: string;
  mode: 'inherit' | 'custom';
  days: number | null;
}

export interface AutoArchiveRunResult {
  checked: number;
  archived: number;
  failed: number;
  nextCursor: string | null;
}
