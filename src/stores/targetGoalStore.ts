import { create } from 'zustand';

export const TARGET_GOAL_STORAGE_KEY = 'taskflow.targetGoals.v1';

export const TARGET_GOAL_CRITERIA = [
  { value: 'application_received', label: '応募・申込が来たとき' },
  { value: 'order_received', label: 'ココナラで注文を受けたとき' },
  { value: 'work_started', label: '鑑定を開始したとき' },
  { value: 'document_completed', label: '鑑定書が完成したとき' },
  { value: 'delivered', label: '納品したとき' },
  { value: 'custom_task', label: '指定タスクが完了したとき' },
] as const;

export type TargetGoalCriterion = typeof TARGET_GOAL_CRITERIA[number]['value'];

export interface TargetGoalUnit {
  id: string;
  label: string;
  projectId: string | null;
  taskId: string | null;
}

export interface TargetGoal {
  id: string;
  title: string;
  targetCount: number;
  criterion: TargetGoalCriterion;
  units: TargetGoalUnit[];
}

const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !value.includes('/');
const validCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20;
const validCriterion = (value: unknown): value is TargetGoalCriterion =>
  TARGET_GOAL_CRITERIA.some((criterion) => criterion.value === value);

function normalizeUnit(value: unknown, index: number): TargetGoalUnit | null {
  if (!value || typeof value !== 'object') return null;
  const unit = value as Partial<TargetGoalUnit>;
  if (!validId(unit.id) || typeof unit.label !== 'string') return null;
  return {
    id: unit.id,
    label: unit.label.trim().slice(0, 100) || `${index + 1}人目`,
    projectId: unit.projectId === null || unit.projectId === undefined ? null : validId(unit.projectId) ? unit.projectId : null,
    taskId: unit.taskId === null || unit.taskId === undefined ? null : validId(unit.taskId) ? unit.taskId : null,
  };
}

function normalizeGoal(value: unknown): TargetGoal | null {
  if (!value || typeof value !== 'object') return null;
  const goal = value as Partial<TargetGoal>;
  if (!validId(goal.id) || typeof goal.title !== 'string' || !validCount(goal.targetCount) || !validCriterion(goal.criterion) || !Array.isArray(goal.units)) return null;
  const units = goal.units.slice(0, goal.targetCount).map(normalizeUnit).filter((unit): unit is TargetGoalUnit => Boolean(unit));
  return {
    id: goal.id,
    title: goal.title.trim().slice(0, 160) || '達成目標',
    targetCount: goal.targetCount,
    criterion: goal.criterion,
    units,
  };
}

function readGoals(): TargetGoal[] {
  const raw: unknown = JSON.parse(localStorage.getItem(TARGET_GOAL_STORAGE_KEY) || '[]');
  if (!Array.isArray(raw)) return [];
  const goals = raw.map(normalizeGoal).filter((goal): goal is TargetGoal => Boolean(goal));
  return [...new Map(goals.map((goal) => [goal.id, goal])).values()];
}

function persist(goals: TargetGoal[]): boolean {
  try {
    localStorage.setItem(TARGET_GOAL_STORAGE_KEY, JSON.stringify(goals));
    return false;
  } catch {
    return true;
  }
}

interface TargetGoalState {
  goals: TargetGoal[];
  persistenceFailed: boolean;
  hydrate: () => void;
  save: (goal: TargetGoal) => void;
  remove: (id: string) => void;
}

export const useTargetGoalStore = create<TargetGoalState>((set) => ({
  goals: [],
  persistenceFailed: false,
  hydrate: () => {
    try {
      set({ goals: readGoals(), persistenceFailed: false });
    } catch {
      set({ goals: [], persistenceFailed: true });
    }
  },
  save: (goal) => set((state) => {
    const goals = [...state.goals.filter((item) => item.id !== goal.id), goal];
    return { goals, persistenceFailed: persist(goals) };
  }),
  remove: (id) => set((state) => {
    const goals = state.goals.filter((goal) => goal.id !== id);
    return { goals, persistenceFailed: persist(goals) };
  }),
}));
