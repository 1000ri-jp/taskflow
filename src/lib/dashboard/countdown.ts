export interface CountdownTarget { projectId: string; taskId: string }
export interface CountdownTask {
  title: string;
  projectName: string;
  dueDate: string | null;
  isCompleted: boolean;
  isAbandoned: boolean;
}
export interface SharedCountdownData {
  status: 'unset' | 'ready' | 'restricted' | 'unavailable';
  target: CountdownTarget | null;
  task: CountdownTask | null;
  revision: number;
}

export function isCountdownTarget(value: unknown): value is CountdownTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && ['projectId', 'taskId'].every((key) =>
    typeof record[key] === 'string' && /^[^/\s]{1,128}$/.test(record[key]) && record[key] !== '.' && record[key] !== '..');
}

// Everyone uses the same calendar day, regardless of their device's timezone.
const japanDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });
export function countdownDay(date: Date): string {
  return japanDate.format(date);
}
export function describeCountdown(task: CountdownTask, now = new Date()) {
  if (task.isCompleted) return { label: '完了', tone: 'green' as const };
  if (task.isAbandoned) return { label: '中止', tone: 'neutral' as const };
  if (!task.dueDate || Number.isNaN(new Date(task.dueDate).getTime())) return { label: '期限未設定', tone: 'neutral' as const };
  const days = Math.round((Date.parse(countdownDay(new Date(task.dueDate))) - Date.parse(countdownDay(now))) / 86_400_000);
  if (days < 0) return { label: `期限超過 ${-days}日`, tone: 'red' as const };
  if (days === 0) return { label: '今日が期限', tone: 'amber' as const };
  return { label: `あと${days}日`, tone: 'amber' as const };
}
