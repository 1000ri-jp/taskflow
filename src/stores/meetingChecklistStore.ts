import { create } from 'zustand';
import { MEETING_ID, containsMeetingSecret } from '@/lib/dashboard/meeting-proposals';
import { MEETING_BUNDLES } from '@/lib/dashboard/meeting-bundles';
import { validChecklistDate, validChecklistItemKey, type ChecklistPlacement, type ChecklistDraftItem } from '@/lib/dashboard/meeting-checklists';

export const MEETING_CHECKLIST_STORAGE_KEY = 'taskflow.meetingChecklistDraft.v1';
type Draft = { placements: Record<string, ChecklistPlacement>; items: Record<string, ChecklistDraftItem> };
const bundleIds = new Set(MEETING_BUNDLES.map(b => b.id));
const empty = (): Draft => ({ placements: {}, items: {} });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 200 && !/[\/\s]/.test(v);
function validPlacement(v: unknown): v is ChecklistPlacement {
  return record(v) && id(v.projectId) && id(v.taskId) && typeof v.title === 'string' && !!v.title.trim() && v.title.length <= 160 && !containsMeetingSecret(v.title);
}
export function parseChecklistDraft(raw: string | null): Draft {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null');
    if (!record(parsed) || parsed.meetingId !== MEETING_ID) return empty();
    const placements = record(parsed.placements) ? Object.fromEntries(Object.entries(parsed.placements).filter(([key,value]) => bundleIds.has(key) && validPlacement(value)).map(([key,value]) => {
      const p = value as ChecklistPlacement;
      return [key,{projectId:p.projectId,taskId:p.taskId,title:p.title}];
    })) : {};
    const items = record(parsed.items) ? Object.fromEntries(Object.entries(parsed.items).filter(([key,value]) => validChecklistItemKey(key) && record(value) && typeof value.checked === 'boolean' && (value.dueDate === undefined || validChecklistDate(value.dueDate))).map(([key,value]) => {
      const item = value as ChecklistDraftItem;
      return [key,{checked:item.checked,...(item.dueDate === undefined ? {} : {dueDate:item.dueDate})}];
    })) : {};
    return { placements, items };
  } catch { return empty(); }
}
interface State extends Draft {
  persistenceFailed: boolean;
  hydrate: () => void;
  setPlacement: (bundleId: string, value?: ChecklistPlacement) => boolean;
  setItem: (key: string, value?: ChecklistDraftItem) => boolean;
}
// Local prototype only. No task, checklist or notification mutations.
export const useMeetingChecklistStore = create<State>((set,get) => {
  function write(update: (draft: Draft) => void) {
    let draft: Draft = { placements:{...get().placements},items:{...get().items} };
    let persistenceFailed = false;
    try {
      const saved = parseChecklistDraft(localStorage.getItem(MEETING_CHECKLIST_STORAGE_KEY));
      draft = get().persistenceFailed ? {placements:{...saved.placements,...draft.placements},items:{...saved.items,...draft.items}} : saved;
      update(draft);
      localStorage.setItem(MEETING_CHECKLIST_STORAGE_KEY,JSON.stringify({meetingId:MEETING_ID,...draft}));
    } catch { update(draft); persistenceFailed = true; }
    set({...draft,persistenceFailed});
  }
  return {
    ...empty(), persistenceFailed:false,
    hydrate: () => { try { set({...parseChecklistDraft(localStorage.getItem(MEETING_CHECKLIST_STORAGE_KEY)),persistenceFailed:false}); } catch { set({persistenceFailed:true}); } },
    setPlacement: (key,value) => {
      if (!bundleIds.has(key) || (value !== undefined && !validPlacement(value))) return false;
      write(draft => { if (value) draft.placements[key] = {projectId:value.projectId,taskId:value.taskId,title:value.title.trim()}; else delete draft.placements[key]; });
      return true;
    },
    setItem: (key,value) => {
      if (!validChecklistItemKey(key) || (value !== undefined && (typeof value.checked !== 'boolean' || (value.dueDate !== undefined && !validChecklistDate(value.dueDate))))) return false;
      write(draft => { if (value) draft.items[key] = {checked:value.checked,...(value.dueDate === undefined ? {} : {dueDate:value.dueDate})}; else delete draft.items[key]; });
      return true;
    },
  };
});
