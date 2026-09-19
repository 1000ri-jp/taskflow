import type { OrganizationPreview, OrganizationContext } from '@/lib/task/organizationTypes';
import type { OrganizationTaskOption } from './OrganizationDraftEditor';

const fieldLabels: Record<string, string> = { title: '名前', description: '説明', listId: 'リスト', assigneeIds: '担当', dueDate: '期限', durationDays: '必要日数', isDueDateFixed: '期限固定', parentTaskId: '親の仕事', dependsOnTaskIds: '前提の仕事', relatedTaskIds: '関連する仕事', isCompleted: '完了', completedAt: '完了日', isAbandoned: '中止', isArchived: 'アーカイブ', workState: '進め方' };
export function PreviewChanges({ preview, tasks, context, compact = false, expanded = false }: { preview: OrganizationPreview; tasks: OrganizationTaskOption[]; context: OrganizationContext; compact?: boolean; expanded?: boolean }) {
  const displayValue = (field: string, value: unknown): string => {
    if (value == null || value === '') return '未設定';
    if (field === 'isCompleted' && typeof value === 'boolean') return value ? '完了' : '未完了';
    if (typeof value === 'boolean') return value ? 'はい' : 'いいえ';
    if (Array.isArray(value)) return value.map(id => field === 'assigneeIds' ? context.members.find(member => member.id === id)?.displayName || '名前未取得' : tasks.find(task => task.id === id)?.title || '名前未取得').join('・') || 'なし';
    if (field === 'listId') return context.lists.find(list => list.id === value)?.name || '名前未取得';
    if (field === 'parentTaskId') return tasks.find(task => task.id === value)?.title || '名前未取得';
    if (['dueDate', 'completedAt'].includes(field) && typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' });
    if (field === 'workState' && typeof value === 'object') { const state = value as Record<string, unknown>; return [state.status === 'hold' ? '保留' : state.status === 'wait' ? '待ち' : '', state.reason, state.resumeCondition && `再開条件: ${state.resumeCondition}`, state.reviewAt && `見直し: ${state.reviewAt}`].filter(Boolean).join(' · '); }
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '変更内容を確認';
  };
  const short = (value: string) => { const chars = Array.from(value.replace(/\s+/g, ' ').trim()); return chars.length > 120 ? `${chars.slice(0, 120).join('')}…` : chars.join(''); };
  const mainFields = new Set(['create', 'new_parent'].includes(preview.kind)
    ? ['title', 'description', 'assigneeIds', 'dueDate']
    : ['title', 'description', 'assigneeIds', 'dueDate', 'isCompleted', 'isAbandoned', 'workState', 'parentTaskId', 'dependsOnTaskIds', 'relatedTaskIds']);
  const comparable = (field: string, value: unknown): string => {
    if (value == null || typeof value === 'string' && !value.trim() || Array.isArray(value) && !value.length) return '';
    if (['isCompleted', 'isAbandoned', 'isArchived'].includes(field) && value === false) return '';
    return JSON.stringify(Array.isArray(value) ? [...value].sort() : value);
  };
  return <div className="space-y-2">{preview.changes.map((change, index) => {
    const concise = change.fields?.filter(field => mainFields.has(field.field) && comparable(field.field, field.before) !== comparable(field.field, field.after)) ?? [];
    const changedFields = change.fields?.filter(field => comparable(field.field, field.before) !== comparable(field.field, field.after));
    const fields = (truncate: boolean) => <dl className="mt-2 space-y-1">{(truncate ? concise : expanded ? changedFields : change.fields)?.map((field, fieldIndex) => {
      const before = change.before === '' ? '新規' : displayValue(field.field, field.before);
      const after = displayValue(field.field, field.after);
      return <div key={fieldIndex} className={truncate ? 'grid gap-x-2 sm:grid-cols-[6rem_minmax(0,1fr)]' : undefined}><dt className="font-medium">{fieldLabels[field.field] ?? '変更内容'}</dt><dd className="whitespace-pre-wrap break-words"><span className="text-muted-foreground">{truncate ? short(before) : before}</span> → {truncate ? short(after) : after}</dd></div>;
    })}</dl>;
    return <div key={`${change.taskId}:${index}`} className="text-xs"><p className="text-muted-foreground">{change.title} · {change.summary}</p>
      {compact && !expanded && concise.length > 0 && fields(true)}
      {(change.fields?.length || change.fields === undefined && (change.before !== undefined || change.after !== undefined)) ? expanded ? <div className="mt-1">{change.fields !== undefined ? fields(false) : <><p className="whitespace-pre-wrap break-words text-muted-foreground">変更前：{change.before || '（新規）'}</p><p className="mt-2 whitespace-pre-wrap break-words">変更後：{change.after}</p></>}</div> : <details className="mt-1"><summary className="cursor-pointer">変更前 → 変更後</summary>{change.fields !== undefined ? fields(false) : <><p className="mt-1 whitespace-pre-wrap break-words">{change.before || '（新規）'}</p><p className="mt-2 whitespace-pre-wrap break-words border-t pt-2">{change.after}</p></>}</details> : null}
    </div>;
  })}{preview.checklist && preview.checklist.length > 0 && <div className="text-xs"><p className="font-medium">追加するチェック項目</p><ul className="mt-1 list-disc space-y-1 pl-5">{preview.checklist.map((item, index) => <li key={index} className="whitespace-pre-wrap break-words">{item}</li>)}</ul></div>}{preview.warnings.map((warning, index) => <p key={index} className="text-xs text-amber-800">{warning}</p>)}</div>;
}
