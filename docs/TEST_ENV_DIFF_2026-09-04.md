# TaskFlow テスト環境差分インベントリ

比較日：2026-09-04（JST）

## 比較対象

- テスト環境・実作業先：`/Users/kozue/taskflow-readonly-ui`（`codex/task-usability-readonly`）
- 保存済みプロジェクト側：`/Users/kozue/taskflow`（`feature/my-dashboard`）
- 両方の比較時HEAD：`af3b7c0`

テスト環境の未コミット／未追跡成果を正として維持する。別WorkTreeへの一括コピー、reset、checkout、削除、push、PR、デプロイは行わない。

## 差分サマリー

- テスト環境だけに変更があるパス：156（本インベントリを含む）
- 両環境で変更されているパス：15（同一内容5、内容差あり10）
- 保存済みプロジェクト側だけに変更があるパス：1
  - `src/app/(dashboard)/page.tsx`（既存 `/` を維持する変更。失わないこと）
- テストファイル：63（上記カテゴリ内の内数）

## テスト環境だけにあるもの

| 区分 | パス数 | 主な内容 |
| --- | ---: | --- |
| 検証・引き継ぎ文書 | 9 | `docs/AUTO_ARCHIVE_PREVIEW.md`、`DASHBOARD_*`、`PROJECT_TASK_VIEWS.md`、`SHARED_COMMENT_REVIEW_REQUESTS.md`、総合監査・引き継ぎ、本インベントリ |
| 画面・ルート・API | 9 | ボード／レイアウト／設定、`settings/browser-backup`、`api/dashboard/countdown` と各テスト |
| コンポーネント | 55 | 別タスクビュー、表示設定、確認依頼、チェックリスト、目標、朝会、カウントダウン、タスク詳細と各テスト |
| フック | 14 | コメント受信箱、会議メンバー、Googleカレンダー、カウントダウン、タスク詳細、表示ナビゲーションと各テスト |
| ロジック・Firebase補助 | 39 | AIパネル、ボード表示／並び／アーカイブ、ブラウザバックアップ、ブリーフ／朝会／目標、確認依頼、チェックリスト順序と各テスト |
| ブラウザ保存ストア | 28 | ボード表示・並び、受信箱、停止プロジェクト、目標、直近日数、Meet、朝会、チェック担当、自動アーカイブ候補と各テスト |
| fixture | 1 | `src/test/taskViewFixtures.ts` |
| 型追加 | 1 | `src/types/index.ts` の確認依頼・親子タスク関連フィールド |

## 両環境で変更され、テスト環境側が発展しているもの

- `src/app/(dashboard)/projects/[projectId]/board/page.tsx`
- `src/components/common/Sidebar.tsx`
- `src/components/dashboard/KozueDashboard.tsx`
- `src/hooks/useGoogleCalendar.ts`
- `src/hooks/useMyTasks.ts`
- `src/hooks/useTaskFlowBrief.ts`
- `src/lib/dashboard/brief.ts` / `brief.test.ts`
- `src/lib/dashboard/calendar.ts` / `calendar.test.ts`

同一内容は、`my-dashboard/page.tsx`、`daily-topic.ts` とそのテスト、`google/calendar.ts` とそのテスト。

## 保存範囲の区別

- 共有書き込み：コメント投稿、共有確認依頼の子タスク、共有チェックリスト順序、手動アーカイブ。
- ブラウザ限定：表示ビュー・並び、停止プロジェクト、受信箱、目標、Meet、朝会下書き、チェック担当、自動アーカイブ候補、テスト用カウントダウン。
- 表示のみ：ダッシュボード分類、計画リスト／テーブル／カレンダー、おすすめタスク、スコアの固定サンプル。
- 未接続：Googleカレンダー、Gmail実データ、Google Chat、朝会AI再生成、目標条件ごとのイベント検出。

旧ブラウザバックアップは19種類中18種類を保存した2026-09-03時点のスナップショットで、後から追加された `taskflow.targetGoals.v1` は含まれない。現在の書き出し許可リストは同キーを加えた20種類。2026-09-04 13:18 JSTのlocalhost実画面では、20種類中19種類に保存値があり、達成目標・人数枠・紐づけタスクも1件取得できることを確認した。既存バックアップは上書きしていない。

ブラウザ保存値や私的バックアップはGit差分へ含めない。実ユーザーへの試験投稿、Firebaseルール／インデックス反映、本番展開は別途承認が必要。
