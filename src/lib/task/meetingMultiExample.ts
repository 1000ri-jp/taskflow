import type { OrganizationData } from './organizationEngine';
import type { OrganizationMultiAnalysis, OrganizationSource } from './organizationTypes';

export const MEETING_MOCK_PROJECTS = [
  { id: 'secretary-demo', name: '架空の制作プロジェクト' },
  { id: 'secretary-demo-office', name: '架空の総務プロジェクト' },
] as const;
export const MULTI_PROGRESS_TASK_ID = 'multi-progress';
const creativeId = MEETING_MOCK_PROJECTS[0].id;
const officeId = MEETING_MOCK_PROJECTS[1].id;
const transcript = `2026年9月14日 9時 制作・総務の朝会（架空の例）
本人：制作プロジェクトの「展示会の紹介文」は初稿のレビューが終わりました。申込先URLの確認が残っている、と既存の仕事へ追記してください。
同僚：総務プロジェクトの「備品の見積もり確認」は見積書がそろいました。比較表はまだ作っていない、と既存の仕事へ追記してください。
本人：制作プロジェクトで「展示会の持ちもの一覧」を新しく作ります。担当は本人、期限は2026年9月18日。出展に必要な品目と数量がそろった一覧を完成条件にします。
同僚：共通の紹介資料も作るとよさそうですが、制作と総務のどちらの仕事にするか、担当も期限もまだ決めていません。`;
export const meetingMultiExampleSource = (): OrganizationSource => ({
  kind: 'meeting', id: 'meeting-multi-example', title: '制作・総務の朝会（架空の例）', text: transcript, occurredAt: '2026-09-14T00:00:00.000Z',
});

/** Explicit example insertion only. Existing work, comments and earlier decisions stay intact. */
export function addMeetingMultiExampleData(data: OrganizationData, projectId: string) {
  if (!MEETING_MOCK_PROJECTS.some(project => project.id === projectId)) return;
  if (data.tasks[MULTI_PROGRESS_TASK_ID]) return;
  const now = new Date('2026-09-13T00:00:00.000Z');
  data.tasks[MULTI_PROGRESS_TASK_ID] = {
    projectId, listId: data.listIds[0] || 'doing', order: 1,
    title: projectId === creativeId ? '展示会の紹介文' : '備品の見積もり確認',
    description: projectId === creativeId ? '展示会で公開する紹介文を作る。初稿のレビューを待っている。' : '必要な備品の見積書を集め、比較表を作る。',
    assigneeIds: [projectId === creativeId ? 'e2e-mock-user' : 'demo-colleague'],
    labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null,
    startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false,
    isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false,
    archivedAt: null, archivedBy: null, createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now,
  };
}

/** Fixed, labelled QA proposals; this function does not invoke an AI model. */
export function meetingMultiExampleProposals(listIds: Readonly<Record<string, string>>): OrganizationMultiAnalysis['proposals'] {
  return [
    { projectId: creativeId, draft: {
      kind: 'update', taskIds: [MULTI_PROGRESS_TASK_ID], targetTaskId: MULTI_PROGRESS_TASK_ID,
      description: '初稿のレビューは完了。申込先URLの確認が残っている。', descriptionMode: 'append', speech: 'report',
      reason: '制作プロジェクトが明示され、既存の紹介文への進捗追記が求められています。仕事全体の完了とは扱いません。',
      quote: '制作プロジェクトの「展示会の紹介文」は初稿のレビューが終わりました。申込先URLの確認が残っている、と既存の仕事へ追記してください。',
    } },
    { projectId: officeId, draft: {
      kind: 'update', taskIds: [MULTI_PROGRESS_TASK_ID], targetTaskId: MULTI_PROGRESS_TASK_ID,
      description: '見積書はそろった。比較表はまだ作っていない。', descriptionMode: 'append', speech: 'report',
      reason: '総務プロジェクトが明示され、既存の備品見積もりへの進捗追記が求められています。',
      quote: '総務プロジェクトの「備品の見積もり確認」は見積書がそろいました。比較表はまだ作っていない、と既存の仕事へ追記してください。',
    } },
    { projectId: creativeId, draft: {
      kind: 'create', taskIds: [], title: '展示会の持ちもの一覧', listId: listIds[creativeId] || 'doing',
      description: '完了条件：出展に必要な品目と数量がそろった一覧を作る。', assigneeIds: ['e2e-mock-user'], dueDate: '2026-09-18', speech: 'decision',
      reason: '制作の仕事として成果物・担当・期限が決定しています。',
      quote: '制作プロジェクトで「展示会の持ちもの一覧」を新しく作ります。担当は本人、期限は2026年9月18日。出展に必要な品目と数量がそろった一覧を完成条件にします。',
    } },
  ];
}
export const MEETING_MULTI_UNCERTAINTY = '共通の紹介資料は、対象プロジェクト・担当・期限が未確定です。決まってから変更案にしてください。';
