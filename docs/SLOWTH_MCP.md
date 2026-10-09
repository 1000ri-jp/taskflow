# Slowth MCP と Dot の連携

Taskflow のタスク・コメント・確認・サブタスク・チェックリスト・添付を、既存の共有サービス経由で MCP から読み書きします。画面や PAT の API を置き換えず、OAuth 接続に許可された範囲で同じデータを扱います。

## 構成と契約

- `src/app/api/mcp/route.js`：MCP の JSON-RPC 入口。
- `src/lib/mcp/`：公開契約、入力検証、共通タスク操作、調整台帳、OAuth の接続検証。
- `src/pages/api/oidc/[...path].js`、`scripts/mcp-events/oidc-*`：OIDC の認証・保存。署名鍵・cookie key・保存暗号鍵は Secret Manager の参照を使用します。
- `src/app/mcp-connect/`、`src/pages/api/mcp-consent.js`：接続本人による Google アカウント選択と同意。通常ログインの動作は保持します。
- `scripts/mcp-events/`、`mcp-events-functions/`：変更の記録、署名付き通知、再送、処理済みの保存。Functions の `lib/` は prepare で生成します。
- `tools/slowth-worker/`：明示的な設定で動く Mac の Codex ワーカー。稼働中の状態や委任情報は Git の追跡対象にしません。

共通ツールは `get_task_contract`、`read_task_data`、`write_task_data` です。既存の `list_task_updates` と `acknowledge_task_updates` で通知を取得・処理済みにします。項目ごとの専用ツールを増やさず、TypeScript のモデルから生成した契約と関連リソースの操作を使用します。

`read_task_data` の続きは返されたカーソルで取得します。通知フィードにはカーソルがありません。最大50件を処理し、保存と報告が成功した実イベントだけを ACK してから次の通知を取得します。Webhook の HTTP 200 は受信結果であり、AI の作業完了の証拠ではありません。

## 認可と保存

現在の本番設定は承認済みの1プロジェクトと接続本人に限定しています。対象の拡大はコードの保存・マージとは別の判断です。イベント読取と、タスク読取・書込の追加同意を区別し、接続の期限・失効・現在のメンバー権限を操作ごとに確認します。

書込は共有サービスのトランザクション内で行います。古い版を拒否し、同じ操作ID・同じ内容の再送では保存済みの結果を返します。一括操作の途中失敗は、成功済み・失敗・未実行を区別して返します。投稿者・確認回答者・記録時刻・導出値を任意の入力から偽造することはできません。

Dot は `coordination.propose` に理由と仕事の分解を保存し、実際の子タスク・担当・前提を保存した後で有効化します。利用可能な能力で着手し、成果・検証結果を親へ添付して、人間の確認を待ちます。人間の実回答を `sync_human` で同期し、修正時は新しい実行版へ進みます。AI の確認代行は拒否します。計画の完了と通常の親タスクの完了は別です。

## 設定・配備・復旧

開発・CI・Functions は Node.js 22 を使用します。OAuth の Node HTTP API を扱うため、`pages/` には API エンドポイントだけを置きます。App Router の画面に追加した非null指定は、この API 追加による Next.js の互換型への対応です。

`apphosting.yaml` は既存の本番設定と Secret Manager の参照を保持しています。実際の鍵、OAuth token、callback secret、実行状態、非公開の成果URLはコミットしません。Functions の非秘密設定の例は `mcp-events-functions/.env.example` を参照してください。

```sh
npm run mcp:check
npm run worker:check
npm run worker:test
```

Functions は `firebase.json` の predeploy で `prepare:source` と構文検査を実行します。アプリ用 App Hosting ソースから Functions とローカルワーカーを除外しています。アプリ・Functions・Firestore の索引を別々に扱い、裸の `firebase deploy` を使用しません。権限の追加や接続の新規作成は、この統合作業では行いません。

Mac ワーカーの設定・起動・停止時の扱いは [SLOWTH_WORKER.md](SLOWTH_WORKER.md)、アプリ配備は [FIREBASE_APP_HOSTING_RELEASE.md](FIREBASE_APP_HOSTING_RELEASE.md) にあります。GitHub への保存・PR・マージだけで、新しい本番配備やワーカーの設定変更が完了したとは扱いません。

## 移管した実装と確認の範囲

この統合は、既存の配備用コピーから確認済みの MCP・通知処理と、Mac ワーカーのソースを選択して移したものです。配備用アプリ全体や別の UI・素材を上書きしていません。元の作業フォルダとローカル保全アーカイブは維持しています。

本番ではタスクの読み書き、割り振り、実成果と本人確認を個別に確認済みです。通知を起点とするネイティブ実行の起動元、真正な修正の往復、継続運用の全条件は引き続き別の確認項目です。機能を Git に取り込んだことを理由に、これらを達成済みとしません。
