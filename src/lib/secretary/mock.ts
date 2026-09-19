// Synthetic workbench only. Never imported by the API or used as an LLM fallback.
import { applyAction, atJstMorning, jstDay, mergeReview, needsReview, taskText } from './engine';
import { emptySecretaryState, type ActionRequest, type Interpretation, type SecretarySnapshot, type SecretaryState, type SecretaryTask, type SecretaryView } from './types';
import { emptyGoogleSource } from '@/lib/google/workspace/types';
import { applyIncomingAction, type IncomingActionRequest } from './incomingDecisions';

export interface MockSecretary { tasks: SecretaryTask[]; state: SecretaryState; failed: boolean; incomingAt?: string }
export function createMockSecretary(userId: string, now: string): MockSecretary {
  const yesterday = jstDay(new Date(new Date(now).getTime() - 86400000).toISOString());
  const common = { projectId: 'secretary-demo', projectName: '架空の制作プロジェクト', description: '', listName: '進行中', assigneeIds: [userId], startDate: null,
    dueDate: null, durationDays: null, isDueDateFixed: false, dependsOn: [], priority: null, isCompleted: false, isAbandoned: false, isArchived: false, completedAt: null, complete: true, canWrite: true, version: '0' };
  const tasks: SecretaryTask[] = [
    { ...common, key: 'secretary-demo/draft', taskId: 'draft', title: '案内文を仕上げる', description: '引き受け済み。目的は来週の公開準備。', comments: [
      { id: 'draft-wait', authorId: 'demo-colleague', createdAt: now, content: `画像の到着待ち。${yesterday}に届く予定。届いたら案内文に入れる。` }], dueDate: atJstMorning(jstDay(now)), isDueDateFixed: true },
    { ...common, key: 'secretary-demo/check', taskId: 'check', title: '公開前の確認', description: '案内文が完成してから内容を確認する。引き受け済み。', dependsOn: ['secretary-demo/draft'], comments: [] },
    { ...common, key: 'secretary-demo/idea', taskId: 'idea', title: '別の告知案を考える', description: '会話に出たアイデア。まだ引き受けていない。', comments: [] },
    { ...common, key: 'secretary-demo/old', taskId: 'old', title: '旧版の案内文を仕上げる', description: '新しい案内文に一本化したため、旧版は不要。中止が決定。', comments: [] },
    { ...common, key: 'secretary-demo/ready', taskId: 'ready', title: '公開用の紹介文を整える', description: '引き受け済み。15分で短い紹介文を整える。目的は公開の準備。必要な素材は揃っている。', comments: [] },
  ];
  tasks[0].context = { projectDescription: '案内を公開し、申込を受け付けられるようにする。', parentState: 'unset', parent: null, milestoneState: 'ready', milestone: { id: 'release', title: '案内の公開', description: '案内と申込先を確認して公開する。', status: 'planned', dueDate: null }, taskKind: 'task', sourceComment: null };
  return { tasks, state: emptySecretaryState(), failed: false, incomingAt: now };
}
function version(task: SecretaryTask) { return JSON.stringify({ ...task, version: '' }); }
export function mockView(mock: MockSecretary, userId: string, now: string): SecretaryView {
  const tasks = mock.tasks.filter(t => t.assigneeIds.includes(userId)).map(t => ({ ...t, complete: !mock.failed, version: version(t) }));
  const snapshot: SecretarySnapshot = { userId, tasks: tasks.map(task => ({ ...task, checklists: task.checklists ?? [], checklistStatus: task.complete ? 'ready' : 'unavailable' })), checkedAt: now, signature: JSON.stringify(tasks),
    coverage: { status: mock.failed ? 'partial' : tasks.length ? 'ready' : 'empty', issues: mock.failed ? ['架空のコメント取得失敗を再現しています。'] : [], projects: 1, excludedProjects: 0 } };
  const item = { id: 'mock-mail-1', title: '紹介文の確認', text: '公開用の紹介文を確認してください。', at: mock.incomingAt ?? '2026-09-12T00:00:00Z', url: 'https://mail.google.com/mail/#all/mock-mail-1', sourceName: '架空の担当者' };
  snapshot.incoming = { email: 'sample@example.test', ownerName: '架空の利用者', accessScope: `mock:${userId}`, sourceVersions: { 'gmail:mock-mail-1': JSON.stringify(item) },
    signature: JSON.stringify([item, tasks.map(t => [t.key, t.version])]), selections: { gmail: ['架空の受信トレイ'], chat: [] },
    sources: { gmail: { ...emptyGoogleSource(), connected: true, status: mock.failed ? 'error' : 'ready', fetchedAt: now, items: [item] }, chat: emptyGoogleSource() } };
  return { snapshot, state: mock.state, needsReview: needsReview(mock.state, snapshot, now), mode: 'mock' };
}
/** Explicit canned semantic responses for known synthetic events, not an AI implementation. */
export function mockInterpretations(snapshot: SecretarySnapshot): Interpretation[] {
  return snapshot.tasks.filter(t => !t.isCompleted && !t.isAbandoned).map(t => {
    const latest = t.comments.at(-1);
    const p: Interpretation = { key: t.key, speech: 'request', commitment: 'confirmed', disposition: 'execute',
      reason: '公開準備のために着手できます。', trigger: '', review: null, uncertainties: [], evidence: [{ source: 'task', quote: t.description }], duplicateOf: null, estimateMinutes: 15 };
    if (t.taskId === 'draft' && latest) {
      p.evidence = [{ source: latest.id, quote: latest.content }];
      if (latest.id.startsWith('finished')) { p.speech = 'progress'; p.disposition = 'complete'; p.reason = '完成したとの報告があります。共有の完了を反映できます。'; }
      else if (latest.id.startsWith('arrival')) { p.speech = 'progress'; p.reason = '画像が到着し、公開準備は継続中。現在も必要なので案内文を仕上げる候補です。'; }
      else if (latest.id.startsWith('policy')) { p.speech = 'question'; p.commitment = 'considering'; p.disposition = 'candidate'; p.reason = '会議で変更案が出ていますが、確定した公開の約束を変更するか判断が必要です。'; p.uncertainties = ['公開の約束を変更してよいか']; }
      else { p.speech = 'hold'; p.disposition = 'wait'; p.reason = '画像の到着予定を過ぎています。公開期限に影響するため到着状況の確認を検討します。'; p.trigger = '画像の到着、または公開方針の変更'; p.review = { kind: 'comment_date', commentId: latest.id, date: latest.content.match(/\d{4}-\d{2}-\d{2}/)![0] }; }
    }
    if (t.taskId === 'check') { p.disposition = 'wait'; p.reason = '案内文が未完了なので着手できません。'; p.trigger = '案内文の完成後、確認がなお必要か再評価'; }
    if (t.taskId === 'idea') { p.speech = 'idea'; p.commitment = 'considering'; p.disposition = 'candidate'; p.reason = '話に出た案です。まだ仕事として引き受けていません。'; }
    if (t.taskId === 'old') { p.speech = 'progress'; p.disposition = 'unneeded'; p.reason = '新版への一本化が決定しています。旧版は不要候補です。'; p.duplicateOf = 'secretary-demo/draft'; }
    if (!p.evidence[0].quote) p.evidence = [{ source: 'task', quote: taskText(t) }];
    return p;
  });
}
export function reviewMock(mock: MockSecretary, userId: string, now: string): MockSecretary {
  const { snapshot } = mockView(mock, userId, now);
  const state = mergeReview(mock.state, snapshot, mockInterpretations(snapshot), now, crypto.randomUUID());
  const item = snapshot.incoming!.sources.gmail.items[0];
  state.incomingReview = { signature: snapshot.incoming!.signature, reviewedAt: now, counts: { gmail: 1, chat: 0 }, candidates: [{ id: 'mock-candidate', title: item.title, reason: '公開用の紹介文の確認依頼です。', kind: 'request', uncertainties: [], deadline: null, matchedTaskKeys: ['secretary-demo/ready'], evidence: [{ ...item, service: 'gmail', quote: item.text }] }] };
  return { ...mock, state };
}
export function actIncomingMock(mock: MockSecretary, userId: string, request: IncomingActionRequest, now: string): MockSecretary {
  return { ...mock, state: applyIncomingAction(mock.state, mockView(mock, userId, now).snapshot, request) };
}
export function actMock(mock: MockSecretary, userId: string, request: ActionRequest, now: string): MockSecretary {
  const snapshot = mockView(mock, userId, now).snapshot;
  const result = applyAction(mock.state, snapshot, request, now, crypto.randomUUID());
  const tasks = mock.tasks.map(t => t.key === result.key && result.patch ? { ...t, ...result.patch } : t);
  if (result.patch && request.action !== 'undo') result.state.history.at(-1)!.afterVersion = version(tasks.find(t => t.key === result.key)!);
  return { ...mock, tasks, state: result.state };
}
export function changeMock(mock: MockSecretary, event: 'arrival' | 'policy' | 'finished' | 'failure' | 'recover', now: string): MockSecretary {
  if (event === 'failure' || event === 'recover') return { ...mock, failed: event === 'failure' };
  const content = { arrival: '画像が到着しました。公開の予定はそのまま。案内文を仕上げてください。', policy: '会議で公開をやめる案が出ました。検討中です。まだ決定していません。', finished: '案内文の修正と確認が完了しました。完成です。' }[event];
  return { ...mock, tasks: mock.tasks.map(t => t.taskId === 'draft' ? { ...t, comments: [...t.comments, { id: `${event}-${crypto.randomUUID()}`, content, authorId: 'demo-colleague', createdAt: now }] } : t) };
}
