import { create } from 'zustand';
import { MEETING_ID, MEETING_ACTIONS, containsMeetingSecret } from '@/lib/dashboard/meeting-proposals';
import type { MeetingTarget } from '@/lib/dashboard/meeting-review';

// Keep v1 reviews untouched: old decisions must not silently apply to the new memo.
export const MEETING_REVIEW_STORAGE_KEY = 'taskflow.meetingProposalReview.v2';
export const REVIEW_STATUSES = ['pending', 'adopted', 'held', 'dismissed'] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];
export interface ProposalEdits { title: string; owner: string; dueDate: string; content: string; assigneeIds?: string[] }
export interface ProposalReview { status: ReviewStatus; edits?: ProposalEdits; target?: MeetingTarget }
type Reviews = Record<string, ProposalReview>;
const validIds = new Set(MEETING_ACTIONS.map(p => p.id));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\/\s]/.test(value);
function validTarget(value: unknown): value is MeetingTarget { return isRecord(value) && (value.mode === 'new' || (value.mode === 'existing' && validId(value.taskId) && validId(value.projectId))); }
export function validProposalEdits(value: unknown): value is ProposalEdits {
  if (!isRecord(value) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160 || typeof value.owner !== 'string' || value.owner.length > 100 || typeof value.content !== 'string' || !value.content.trim() || value.content.length > 10000 || typeof value.dueDate !== 'string') return false;
  if ([value.title, value.owner, value.content].some(containsMeetingSecret)) return false;
  if (value.assigneeIds !== undefined && (!Array.isArray(value.assigneeIds) || value.assigneeIds.length > 30 || !value.assigneeIds.every(validId))) return false;
  return !value.dueDate || (/^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) && !Number.isNaN(Date.parse(value.dueDate)) && new Date(value.dueDate).toISOString().slice(0, 10) === value.dueDate);
}
export function parseMeetingReviews(raw: string | null): Reviews {
  try {
    const saved: unknown = JSON.parse(raw ?? 'null');
    if (!isRecord(saved) || saved.meetingId !== MEETING_ID || !isRecord(saved.reviews)) return {};
    return Object.fromEntries(Object.entries(saved.reviews).filter(([id, review]) => validIds.has(id) && isRecord(review) && REVIEW_STATUSES.includes(review.status as ReviewStatus) && (review.edits === undefined || validProposalEdits(review.edits)) && (review.target === undefined || validTarget(review.target))).map(([id, review]) => {
      const checked = review as ProposalReview;
      return [id, { status: checked.status, ...(checked.target ? { target: checked.target.mode === 'new' ? { mode: 'new' } : { mode: 'existing', projectId: checked.target.projectId, taskId: checked.target.taskId } } : {}), ...(checked.edits ? { edits: { title: checked.edits.title, owner: checked.edits.owner, dueDate: checked.edits.dueDate, content: checked.edits.content, ...(checked.edits.assigneeIds ? { assigneeIds: [...new Set(checked.edits.assigneeIds)] } : {}) } } : {}) }];
    }));
  } catch { return {}; }
}
interface MeetingReviewState {
  reviews: Reviews;
  persistenceFailed: boolean;
  hydrate: () => void;
  review: (id: string, status: ReviewStatus) => void;
  edit: (id: string, edits: ProposalEdits) => boolean;
  setTarget: (id: string, target?: MeetingTarget) => void;
  reset: (id: string) => void;
}
// This store is deliberately not connected to Firebase, AI tools or task mutations.
export const useMeetingProposalStore = create<MeetingReviewState>((set, get) => {
  const write = (id: string, next?: ProposalReview) => {
    if (!validIds.has(id)) return;
    let reviews = { ...get().reviews };
    let persistenceFailed = false;
    try {
      const saved = parseMeetingReviews(localStorage.getItem(MEETING_REVIEW_STORAGE_KEY));
      reviews = get().persistenceFailed ? { ...saved, ...reviews } : saved;
      if (next) reviews[id] = next; else delete reviews[id];
      localStorage.setItem(MEETING_REVIEW_STORAGE_KEY, JSON.stringify({ meetingId: MEETING_ID, reviews }));
    } catch {
      if (next) reviews[id] = next; else delete reviews[id];
      persistenceFailed = true;
    }
    set({ reviews, persistenceFailed });
  };
  return {
    reviews: {}, persistenceFailed: false,
    hydrate: () => {
      try { set({ reviews: parseMeetingReviews(localStorage.getItem(MEETING_REVIEW_STORAGE_KEY)), persistenceFailed: false }); }
      catch { set({ persistenceFailed: true }); }
    },
    review: (id, status) => {
      if (REVIEW_STATUSES.includes(status)) write(id, { ...get().reviews[id], status });
    },
    edit: (id, edits) => {
      if (!validIds.has(id) || !validProposalEdits(edits)) return false;
      write(id, { ...get().reviews[id], status: 'pending', edits: { title: edits.title.trim(), owner: edits.owner.trim(), dueDate: edits.dueDate, content: edits.content.trim(), ...(edits.assigneeIds ? { assigneeIds: [...new Set(edits.assigneeIds)] } : {}) } });
      return true;
    },
    setTarget: (id, target) => {
      if (target && !validTarget(target)) return;
      write(id, { ...get().reviews[id], status: 'pending', target });
    },
    reset: (id) => write(id),
  };
});
