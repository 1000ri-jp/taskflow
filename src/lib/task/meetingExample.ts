import type { OrganizationAnalysis, OrganizationSource } from './organizationTypes';
import type { OrganizationData } from './organizationEngine';

const transcript = `2026年9月14日 9時 会議（架空の例）
本人：展示会ポスターを新しく作ります。担当は本人、期限は9月18日。会場・日時・申込先を確認したPDFを完成条件にします。
同僚：公開用の案内文は私が引き継ぎます。タイトルを「9月の公開案内文」に変え、来週月曜日を期限にします。申込先のリンク確認も追記してください。
本人：展示会チラシが二重登録されていました。同じ担当・期間・完了条件です。「展示会チラシ（正本）」を残し、重複分のコメントも残して統合します。
本人：会場アクセス図は完成しました。住所と最寄り駅を確認し、PDFを公開済みです。
同僚：旧会場の仮予約は取りやめることで決定しました。
本人：記念品の手配は予算確定まで保留。予算が承認されたら再開を確認し、9月21日に見直します。
同僚：素材の色見本が届くまで撮影準備を待ちにします。届いた見本の色を確認したら再開。9月18日に再確認します。
本人：FAQを新しく登録する話がありましたが、既存の「出展FAQ」に支払方法の説明を追記するだけで足ります。
同僚：公開済みの告知投稿はそのままで、変更しません。
本人：チケットは買えたと思います。でも決済が通ったかはまだ確認していません。
同僚：動画も作るといいかもしれません。サトウさんにお願いするか、期限も含めて未決定です。
本人：来月の納期が遅れるかもしれませんが、期限変更はまだ決定していません。`;

export const meetingExampleSource = (): OrganizationSource => ({
  kind: 'meeting', id: 'meeting-example', title: '展示会準備会議（架空の例）', text: transcript, occurredAt: '2026-09-14T00:00:00.000Z',
});

/** Only the explicit example button seeds these synthetic tasks; analysis never does. */
export function addMeetingExampleData(data: OrganizationData, projectId: string): void {
  const now = new Date('2026-09-13T00:00:00.000Z');
  const base = { projectId, listId: data.listIds[0] || 'doing', description: '', order: 1, assigneeIds: ['e2e-mock-user'],
    labelIds: [], tagIds: [], dependsOnTaskIds: [], priority: null, startDate: null, dueDate: null, durationDays: null, isDueDateFixed: false,
    isCompleted: false, completedAt: null, isAbandoned: false, isArchived: false, archivedAt: null, archivedBy: null,
    createdBy: 'e2e-mock-user', createdAt: now, updatedAt: now };
  const examples = {
    'meeting-copy': { ...base, title: '公開用の案内文', description: '完了条件：公開用の案内文を完成させる。', dueDate: new Date('2026-09-18T00:00:00+09:00') },
    'meeting-flyer': { ...base, title: '展示会チラシ（正本）', description: '9月の展示会。完了条件：必要情報を載せたチラシを公開する。' },
    'meeting-flyer-duplicate': { ...base, title: '展示会チラシ（重複）', description: '9月の展示会。完了条件：必要情報を載せたチラシを公開する。' },
    'meeting-map': { ...base, title: '会場アクセス図', description: '完了条件：住所と最寄り駅を確認し、PDFを公開する。' },
    'meeting-venue': { ...base, title: '旧会場の仮予約', description: '旧会場の仮予約を確定する。' },
    'meeting-gift': { ...base, title: '記念品の手配', description: '予算内で記念品をそろえる。' },
    'meeting-material': { ...base, title: '撮影準備', description: '素材の色を確認して撮影する。' },
    'meeting-faq': { ...base, title: '出展FAQ', description: '完了条件：出展者の質問と回答を公開する。' },
    'meeting-post': { ...base, title: '告知投稿', description: '告知を公開する。', isCompleted: true, completedAt: now },
  };
  for (const [id, task] of Object.entries(examples)) if (!data.tasks[id]) data.tasks[id] = task;
  const children = {
    'tasks/meeting-flyer-duplicate/comments/note': { content: '申込先は原稿のURLと照合してください。', authorId: 'demo-colleague', createdAt: now },
    'tasks/meeting-map/comments/proof': { content: '住所と最寄り駅を照合し、アクセス図のPDFを公開しました。', authorId: 'e2e-mock-user', createdAt: now },
    'tasks/meeting-map/checklists/checks': { title: '公開確認', items: [{ id: 'address', text: '住所と最寄り駅を確認', isChecked: true, order: 0 }, { id: 'public', text: 'PDFを公開', isChecked: true, order: 1 }], createdAt: now },
  };
  for (const [path, child] of Object.entries(children)) if (!data.children[path]) data.children[path] = child;
}

/** Deterministic QA output, explicitly labelled as an analysis example, never used on live data. */
export function meetingExampleAnalysis(listId: string): OrganizationAnalysis {
  return { drafts: [
    { kind: 'create', taskIds: [], title: '展示会ポスターを作成', description: '完了条件：会場・日時・申込先を確認したPDFを完成させる。', assigneeIds: ['e2e-mock-user'], dueDate: '2026-09-18', listId, speech: 'decision', reason: '既存のチラシと別の成果物として、担当と期限が決定しています。', quote: '展示会ポスターを新しく作ります。担当は本人、期限は9月18日。会場・日時・申込先を確認したPDFを完成条件にします。' },
    { kind: 'update', taskIds: ['meeting-copy'], targetTaskId: 'meeting-copy', title: '9月の公開案内文', description: '申込先のリンクを確認する。', assigneeIds: ['demo-colleague'], dueDate: '2026-09-21', speech: 'decision', reason: '既存の案内文の担当・期限・確認内容を変更します。会議日時から来週月曜日は9月21日です。', quote: '公開用の案内文は私が引き継ぎます。タイトルを「9月の公開案内文」に変え、来週月曜日を期限にします。申込先のリンク確認も追記してください。' },
    { kind: 'merge', taskIds: ['meeting-flyer', 'meeting-flyer-duplicate'], targetTaskId: 'meeting-flyer', speech: 'decision', reason: '同じ成果物・担当・期間・完了条件と確認された重複です。', quote: '展示会チラシが二重登録されていました。同じ担当・期間・完了条件です。「展示会チラシ（正本）」を残し、重複分のコメントも残して統合します。' },
    { kind: 'complete', taskIds: ['meeting-map'], targetTaskId: 'meeting-map', speech: 'report', confirmationPoints: ['住所・最寄り駅の確認とPDF公開が完了条件を満たしていることを確認してください。'], reason: '会議の完了報告と、既存コメント・公開確認の手順が一致しています。最終判断をお願いします。', quote: '会場アクセス図は完成しました。住所と最寄り駅を確認し、PDFを公開済みです。' },
    { kind: 'cancel', taskIds: ['meeting-venue'], targetTaskId: 'meeting-venue', speech: 'decision', reason: '遅れの予測ではなく、予約の取りやめが決定しています。', quote: '旧会場の仮予約は取りやめることで決定しました。' },
    { kind: 'hold', taskIds: ['meeting-gift'], targetTaskId: 'meeting-gift', speech: 'decision', workState: { reason: '予算の確定待ち', resumeCondition: '予算が承認されたら再開を確認する', reviewAt: '2026-09-21' }, reason: '予算承認まで保留し、9月21日に見直すことが決定しています。', quote: '記念品の手配は予算確定まで保留。予算が承認されたら再開を確認し、9月21日に見直します。' },
    { kind: 'wait', taskIds: ['meeting-material'], targetTaskId: 'meeting-material', speech: 'decision', workState: { reason: '素材の色見本の到着待ち', resumeCondition: '届いた見本の色を確認してから再開する', reviewAt: '2026-09-18' }, reason: '待つ対象・再開条件・再確認日が明記されています。', quote: '素材の色見本が届くまで撮影準備を待ちにします。届いた見本の色を確認したら再開。9月18日に再確認します。' },
    { kind: 'update', taskIds: ['meeting-faq'], targetTaskId: 'meeting-faq', description: 'FAQに支払方法の説明を追加する。', speech: 'decision', reason: '新規登録は重複になるため、既存FAQに情報を追記します。', quote: 'FAQを新しく登録する話がありましたが、既存の「出展FAQ」に支払方法の説明を追記するだけで足ります。' },
  ], issues: ['チケットは決済完了が未確認です。購入できたという発言だけでは完了にしません。', '動画はアイデア段階で、サトウさんの特定・担当・期限も未決定です。', '来月の納期は遅れの予測で、期限変更は決定していません。'] };
}
