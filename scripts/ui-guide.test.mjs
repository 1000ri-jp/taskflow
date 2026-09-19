import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { consumers, dependencies, references, routeFor, rawStyles, newOverrides } from './ui-guide.mjs';

describe('UI guide static usage and drift audit', () => {
  it('follows wrappers and reexports without looping or treating type-only imports as consumers', () => {
    assert.deepEqual(references('file.tsx', `import type { A } from './types'; import { type B } from './types2'; import { Button } from '@/components/ui/button'; export { Button } from './wrapper'; const load = import('./lazy');`), ['@/components/ui/button', './wrapper', './lazy']);
    assert.deepEqual(consumers({ shared: [], wrapper: ['shared'], barrel: ['wrapper'], page: ['barrel'], loop: ['page'], other: [] }, ['shared']), { direct: ['wrapper'], indirect: ['barrel', 'loop', 'page'] });
    assert.deepEqual(dependencies({ a: ['b'], b: ['c'], c: ['a'] }, ['a']), ['a', 'b', 'c']);
    assert.equal(routeFor('src/app/(dashboard)/projects/[projectId]/settings/page.tsx'), '/projects/[projectId]/settings');
  });
  it('allows removal but catches new and duplicated local overrides', () => {
    const old = rawStyles('screen.tsx', '<div className="text-sm px-3" />');
    assert.equal(newOverrides({ file: old }, { file: old }).length, 0);
    assert.equal(newOverrides({ file: {} }, { file: old }).length, 0);
    assert.equal(newOverrides({ file: rawStyles('screen.tsx', '<><div className="text-sm px-3" /><div className="text-sm px-3" /></>') }, { file: old }).length, 1);
    assert.equal(newOverrides({ file: rawStyles('screen.tsx', '<div style={{ fontSize: 13 }} />') }, {}).length, 1);
  });
});



describe('UI guide task-row interaction guidance', () => {
  it('keeps the adopted row-face hover and keyboard-focus rule scoped to content-opening task rows', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'task-row-one-line-trial');
    assert.ok(specimen, 'the task-row guide specimen must exist');
    assert.equal(specimen.status, 'trial', 'the composite specimen remains a trial');
    assert.equal(specimen.adoption.status, 'limited');
    assert.equal(specimen.implementation.status, 'partial', 'some real-screen propagation remains a feature-task responsibility');
    assert.ok(specimen.sources.includes('src/components/dashboard/NeoBriefTaskRow.tsx'));
    assert.ok(specimen.sources.includes('src/components/ui/density.ts'), 'existing named density roles remain a registered implementation reference');
    for (const phrase of ['カンバンカード内で展開するサブタスク一覧', '「モアイ」の文字ラベルを表示しない', 'hover', '色遷移', 'キーボードfocus', 'リンク下線', 'アイコン操作', '選択中', '危険操作']) {
      assert.ok(specimen.adoption.summary.includes(phrase), `adoption summary must preserve ${phrase}`);
    }

    const css = fs.readFileSync(path.join(root, 'src/components/ui-guide/ExtendedPreviews.module.css'), 'utf8');
    assert.match(css, /\.oneLineRow\s*\{[^}]*transition:\s*color [^,;]+, background-color [^;]+;/s);
    assert.match(css, /\.oneLineRow:hover\s*\{[^}]*background:\s*color-mix\(/s);
    assert.match(css, /\.oneLineRow:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ring\)/s);

    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    assert.match(standard, /### 13\.19 内容を開くタスク行のhover・focus/);
    assert.match(standard, /プロジェクトを問わずカンバンカード内で展開したサブタスク一覧/);
    assert.match(standard, /taskRowInteraction.*taskCardInteraction.*taskTitle/s);
    assert.match(standard, /全ボタンへ一律適用しない/);
  });
});

describe('UI guide parent-child completion review guidance', () => {
  it('keeps the earlier disconnection historical and records the narrow adopted route separately', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'proposal-review-flow-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial', 'the composite specimen remains a trial');
    assert.equal(specimen.adoption.status, 'limited');
    assert.equal(specimen.implementation.status, 'in-progress', 'the feature task implementation remains separate from this guide task');
    assert.ok(specimen.variants.some(variant => variant.id === 'parent-child-review'));
    for (const phrase of ['ダッシュボード', 'モアイ', '未完了件数', '取得失敗', '対象なし', '保存・状態変更しない', '新しい一覧・キュー']) {
      assert.ok(specimen.adoption.summary.includes(phrase), `adoption summary must preserve ${phrase}`);
    }

    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    assert.match(standard, /機械的な親完了／子未完了質問は接続解除済み/);
    assert.match(standard, /2026-09-17の追加採用指示/);
    assert.match(standard, /### 13\.20 親完了・未完了サブタスクの確認導線/);
    assert.match(standard, /取得失敗は対象なしに見せない/);
    assert.match(standard, /ダッシュボード以外の画面では、モアイが任意の確認入口になる/);
    assert.match(standard, /閉じた状態は親タスク名と未完了サブタスク件数だけ/);
    assert.match(standard, /本人が明示的に選ぶまでは保存もタスク状態変更もしない/);
  });
});

describe('Neo briefing assignee filter guide trial', () => {
  it('records member icons, self default, and the all-members icon as a limited adoption', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'neo-brief-assignee-filter-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial');
    assert.equal(specimen.adoption.status, 'limited');
    assert.equal(specimen.implementation.status, 'implemented');
    assert.ok(specimen.sources.includes('src/components/dashboard/NeoToday.tsx'));
    assert.ok(specimen.sources.includes('src/components/dashboard/NeoMorningBrief.tsx'));
    for (const phrase of ['メンバーアイコン', '自分を初期選択', '全員アイコン']) assert.ok(specimen.adoption.summary.includes(phrase));
    assert.match(specimen.scope, /折り返し・省略.*未採用/);
    assert.match(specimen.scope, /選択UI・寸法・並びは未採用/);
    assert.match(specimen.impact, /選択はコンポーネント内stateだけ/);

    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    assert.match(standard, /### 13\.21 担当者名・アイコンによる今日のブリーフ絞り込み案/);
    assert.match(standard, /自分を初期選択/);
    assert.match(standard, /全員アイコン/);
    assert.match(standard, /名前の折り返し・省略/);
  });
});

describe('Neo no-suggestion history guide', () => {
  it('limits adoption to one framed prior item at a time and Moai comments for reflected changes', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'neo-home-layout-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial');
    assert.equal(specimen.adoption.status, 'limited');
    for (const phrase of ['現在の提案がない場合', 'モアイのコメント', '履歴の寸法は未採用']) {
      assert.ok(specimen.adoption.summary.includes(phrase), `adoption summary must preserve ${phrase}`);
    }
    assert.match(specimen.adoption.summary, /1件ずつ.*枠/);
    const preview = fs.readFileSync(path.join(root, 'src/components/ui-guide/ExtendedPreviews.tsx'), 'utf8');
    assert.match(preview, /提案がない場合を試す/);
    assert.match(preview, /neo-history-current-record/);
    assert.match(preview, /モアイのコメント/);
    assert.match(preview, /次の記録を表示/);
    assert.match(preview, /現在の提案なし/);
  });
});

describe('settings dashboard-order guide', () => {
  it('records dashboard selection as the first app-settings item without adopting other ordering', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'settings-dashboard-order-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial');
    assert.equal(specimen.adoption.status, 'limited');
    assert.match(specimen.adoption.summary, /ダッシュボード.*選択.*最初/);
    assert.match(specimen.scope, /他の設定項目の順序.*採用に含めない/);
    assert.ok(specimen.sources.includes('src/components/ui-guide/ExtendedPreviews.tsx'));
    assert.ok(specimen.sources.includes('src/app/(dashboard)/settings/page.tsx'));
  });
});

describe('Neo shared countdown guide', () => {
  it('records the adopted information-only behavior and aligned spacing relationship', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'neo-shared-countdown-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial');
    assert.equal(specimen.adoption.status, 'limited');
    assert.equal(specimen.implementation.status, 'implemented');
    assert.match(specimen.adoption.summary, /リンクにしない/);
    assert.match(specimen.adoption.summary, /左端とアイコンを揃え/);
    assert.match(specimen.adoption.summary, /具体的なpadding値は採用していない/);
    assert.deepEqual(specimen.variants.map(variant => variant.id), ['aligned-spacing', 'left-padding-reference']);
    assert.ok(specimen.sources.includes('src/components/dashboard/SharedCountdown.tsx'));

    const row = catalog.entries.find(entry => entry.id === 'neo-brief-row-trial');
    assert.match(row.adoption.summary, /担当者アイコンは仕事の続きと同じ約24px/);
    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    assert.match(standard, /### 13\.22 今日の仕事・期限の担当者アイコン/);
    assert.match(standard, /### 13\.23 共通カウントダウンの表示専用と左余白/);
    assert.match(standard, /### 13\.34 共通カウントダウンの内側間隔/);
    assert.match(standard, /採用指示の「少し」を具体化した実装値/);
  });
});

describe('newly surfaced guide trials and handoff states', () => {
  it('makes the calendar task popup and evidence-based task-structure sample selectable from the catalog', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    assert.equal(catalog.revision, 'ui-guide-2026-09-18.17');
    const calendar = catalog.entries.find(entry => entry.id === 'calendar-task-create-trial');
    assert.ok(calendar);
    assert.equal(calendar.status, 'trial');
    assert.equal(calendar.adoption.status, 'limited');
    assert.equal(calendar.implementation.status, 'implemented');
    assert.match(calendar.adoption.summary, /選択日を期限に引き継ぐ/);
    assert.match(calendar.scope, /通信、保存処理は使わない/);
    assert.ok(calendar.sources.includes('src/components/board/TaskCalendarView.tsx'));

    const structure = catalog.entries.find(entry => entry.id === 'task-structure-guidance-trial');
    assert.ok(structure);
    assert.equal(structure.status, 'trial');
    assert.equal(structure.adoption.status, 'limited');
    assert.equal(structure.implementation.status, 'implemented');
    for (const source of ['src/components/task/TaskOrganizer.tsx', 'src/lib/task/organizationAnalysis.ts', 'src/components/dashboard/OrganizationProposalCard.tsx']) assert.ok(structure.sources.includes(source));
    for (const phrase of ['既存の会議内容', '理由', '一般論', '確認']) assert.ok(structure.adoption.summary.includes(phrase));
    assert.match(structure.impact, /変換\/保存処理は機能改善タスク担当/);

    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    for (const section of ['13.32','13.33','13.34','13.35','13.36']) assert.match(standard, new RegExp(`### ${section} `));
  });

  it('keeps Neo spacing and proposal-history alternatives distinct from the adopted specimens', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const brief = catalog.entries.find(entry => entry.id === 'neo-brief-row-trial');
    assert.equal(brief.status, 'trial');
    assert.equal(brief.adoption.status, 'limited');
    assert.deepEqual(brief.variants.map(variant => variant.id), ['standard', 'previous-groups']);
    assert.match(brief.adoption.summary, /gap-x-3.*gap-x-2は現行実装参照値/);

    const home = catalog.entries.find(entry => entry.id === 'neo-home-layout-trial');
    assert.equal(home.status, 'trial');
    assert.equal(home.adoption.status, 'limited');
    assert.ok(home.variants.some(variant => variant.id === 'history-under-proposal'));
    assert.match(home.adoption.summary, /新しい順で縦に並べ.*初期状態は折りたたみ/);
    assert.match(home.adoption.summary, /提案がない場合の1件ずつ表示とは別条件/);
    assert.equal(home.implementation.status, 'partial', 'the Neo-home composite still has separate pending visual verification');

    const preview = fs.readFileSync(path.join(root, 'src/components/ui-guide/ExtendedPreviews.tsx'), 'utf8');
    assert.match(preview, /新しい順で縦に並べ、初期状態は折りたたみます/);
    assert.match(preview, /1件ずつ表示する見本とは、表示条件を分けて確認します/);
  });
});

describe('Completed subtask disclosure guidance', () => {
  it('records the adopted lower spacing separately from the 28px row interpretation', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/ui-guide/catalog.json'), 'utf8'));
    const specimen = catalog.entries.find(entry => entry.id === 'task-row-one-line-trial');
    assert.ok(specimen);
    assert.equal(specimen.status, 'trial');
    assert.equal(specimen.implementation.status, 'partial', 'the specimen contains a verified implementation report but broader scopes remain separate');
    assert.match(specimen.implementation.summary, /§13\.24.*py-1.*24px/);
    assert.match(specimen.implementation.summary, /全体statusはpending.*全プロジェクト.*1件1行.*残る/);
    assert.match(specimen.scope, /タイトル行の内側.*px-2.5 py-1.*mt-1 space-y-0.5/);
    assert.match(specimen.adoption.summary, /タイトル行は内側を少し詰め.*px-2.5 py-1.*mt-1 space-y-0.5/);
    assert.match(specimen.implementation.summary, /min-h-7.*min-h-6.*24px.*通常幅.*390px/);
    assert.equal(specimen.adoption.status, 'limited');
    assert.match(specimen.adoption.summary, /完了済みN件.*上のサブタスク見出しと同程度の下端余白/);
    assert.match(specimen.impact, /min-h-6\/py-1/);
    const css = fs.readFileSync(path.join(root, 'src/components/ui-guide/ExtendedPreviews.module.css'), 'utf8');
    assert.match(css, /\.completedSubtaskSummary\s*\{[^}]*min-height:\s*24px;[^}]*padding-block:\s*4px;/);
    assert.match(css, /\.subtaskOneLineSection\s*\{[^}]*padding:\s*4px 10px;/);
    assert.match(css, /\.subtaskOneLineRows\s*\{[^}]*gap:\s*2px;/);
    assert.match(css, /\.subtaskOneLineRow\s*\{[^}]*min-height:\s*24px;/);
    const standard = fs.readFileSync(path.join(root, 'docs/TASKFLOW_DESIGN_STANDARD_2026-09-13.md'), 'utf8');
    assert.match(standard, /### 13\.24 完了済みサブタスクsummaryの下端余白/);
    assert.match(standard, /28pxの未完了サブタスク行とは区別/);
  });
});

describe('UI guide release dependency comparison', () => {
  it('detects changed or missing nested consumer dependencies even with an identical receiver manifest', () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'taskflow-guide-release-'));
    const source = path.join(temporary, 'source');
    const receiver = path.join(temporary, 'receiver');
    const script = fileURLToPath(new URL('./ui-guide.mjs', import.meta.url));
    const write = (name, value) => {
      const target = path.join(source, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value);
    };
    const run = (...args) => spawnSync(process.execPath, [script, ...args], { cwd: source, encoding: 'utf8' });
    const nested = 'src/lib/nested/presentation.ts';
    try {
      write('src/components/ui/badge.tsx', 'export const Badge = () => <span>Guide</span>;');
      write('src/components/Consumer.tsx', `import { Badge } from './ui/badge'; import { useNested } from '@/hooks/useNested'; export const Consumer = () => <Badge value={useNested()} />;`);
      write('src/hooks/useNested.ts', `import { label } from '@/lib/nested/presentation'; export const useNested = () => label;`);
      write(nested, `export const label = 'original';`);
      write('src/app/screen/page.tsx', `import { Consumer } from '@/components/Consumer'; export default Consumer;`);
      write('src/lib/unrelated.ts', `export const unrelated = true;`);
      for (const name of ['globals.css', 'neo-appearance.css', 'ui-tokens.css']) write(`src/app/${name}`, '');
      write('src/lib/ui-guide/catalog.json', JSON.stringify({ revision: 'test', entries: [{
        id: 'badge', level: 'basic', name: 'Badge', purpose: 'Test dependency comparison', status: 'adopted',
        sources: ['src/components/ui/badge.tsx'], variants: [{ id: 'standard', label: 'Standard' }],
        scope: 'Test only', impact: 'Test consumer', links: [{ href: '/screen', label: 'Screen' }],
      }] }));
      const refresh = run('--init-baseline', '--refresh');
      assert.equal(refresh.status, 0, refresh.stderr);
      fs.cpSync(source, receiver, { recursive: true });
      const matching = run('--compare-worktree', receiver);
      assert.equal(matching.status, 0, matching.stderr);

      fs.writeFileSync(path.join(receiver, nested), `export const label = 'changed';`);
      const changed = run('--compare-worktree', receiver);
      assert.equal(changed.status, 1, 'A changed nested hook dependency must fail receiver comparison');
      assert.ok(changed.stderr.includes(`Not incorporated in ${receiver}: ${nested}`), changed.stderr);
      fs.unlinkSync(path.join(receiver, nested));
      const missing = run('--compare-worktree', receiver);
      assert.equal(missing.status, 1, 'A missing nested dependency must fail receiver comparison');
      assert.ok(missing.stderr.includes(`Not incorporated in ${receiver}: ${nested}`), missing.stderr);

      const manifest = JSON.parse(fs.readFileSync(path.join(source, 'src/lib/ui-guide/release.generated.json'), 'utf8'));
      assert.ok(manifest.files.some(file => file.path === 'src/hooks/useNested.ts'));
      assert.ok(!manifest.files.some(file => file.path === 'src/lib/unrelated.ts'));
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
});
