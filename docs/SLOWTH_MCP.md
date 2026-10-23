# Slowth MCP と Dot の連携

Taskflow のタスク・コメント・確認・サブタスク・チェックリスト・添付を、既存の共有サービス経由で MCP から読み書きします。画面や PAT の API を置き換えず、OAuth 接続に許可された範囲で同じデータを扱います。

## 構成と契約

- `src/app/api/mcp/route.js`：MCP の JSON-RPC 入口。
- `src/lib/mcp/`：公開契約、入力検証、共通タスク操作、調整台帳、OAuth の接続検証。
- `src/pages/api/oidc/[...path].js`、`scripts/mcp-events/oidc-*`：OIDC の認証・保存。署名鍵・cookie key・保存暗号鍵は Secret Manager の参照を使用します。
- `src/app/mcp-connect/`、`src/pages/api/mcp-consent.js`：接続本人による Google アカウント選択と同意。通常ログインの動作は保持します。
- `scripts/mcp-events/`、`mcp-events-functions/`：変更の記録、署名付き通知、再送、処理済みの保存。Functions の `lib/` は prepare で生成します。
- `tools/slowth-worker/`：明示的な設定で動く Mac の Codex ワーカー。稼働中の状態や委任情報は Git の追跡対象にしません。
- `tools/slowth-mcp/`：Claude Code・Claude Desktop 用のローカル stdio MCP サーバー。この OAuth 接続ではなく PAT の REST API を使います。使い方は [README](../tools/slowth-mcp/README.md) を参照してください。

共通ツールは `get_task_contract`、`read_task_data`、`write_task_data` です。既存の `list_task_updates` と `acknowledge_task_updates` で通知を取得・処理済みにします。項目ごとの専用ツールを増やさず、TypeScript のモデルから生成した契約と関連リソースの操作を使用します。

`read_task_data` の続きは返されたカーソルで取得します。通知フィードにはカーソルがありません。最大50件を処理し、保存と報告が成功した実イベントだけを ACK してから次の通知を取得します。Webhook の HTTP 200 は受信結果であり、AI の作業完了の証拠ではありません。

## 認可と保存

現在の本番設定は承認済みの1プロジェクトと接続本人に限定しています。対象の拡大はコードの保存・マージとは別の判断です。イベント読取と、タスク読取・書込の追加同意を区別し、接続の期限・失効・現在のメンバー権限を操作ごとに確認します。

複数プロジェクト読み取りのローカル実装は、既定で無効の設定と新しい明示同意を使用します。全件選択も同意時点の固定リストであり、書き込み・AI作業・イベントを別々に選択します。既存grantへの対象追加はしません。設計、API、検証方法と公開時の残件は [プロジェクト別同意](SLOWTH_MCP_PROJECT_CONSENT.md) を参照してください。

### ClaudeアプリとClaude Codeのリモート接続

`SLOWTH_MCP_OAUTH_CLAUDE=true` はClaude Desktop・web・mobileのhosted connectorを有効にします。固定public client `https://claude.ai/oauth/mcp-oauth-client-metadata` と `https://claude.ai/api/mcp/auth_callback` の完全一致だけを許可します。`SLOWTH_MCP_OAUTH_CLAUDE_CODE=true` は別の固定native client `https://claude.ai/oauth/claude-code-client-metadata` と、`http://localhost:<port>/callback` / `http://127.0.0.1:<port>/callback` のみを許可します。portは1〜65535です。両設定とも本番モードでだけ有効で、既存ChatGPTのclient/callbackを保持します。任意client・任意redirect・動的client登録は許可しません。新しい秘密鍵や永続client secretは不要です。

```sh
claude mcp add --transport http slowth https://slowth.1000ri.jp/api/mcp
```

配備・有効化後、Claudeアプリのコネクタには `https://slowth.1000ri.jp/api/mcp` を指定し、公開identityを使って接続します。Claude Codeでは `/mcp` から認証します。公開scope全件を要求するClaude Codeでは合成用 `events:test` を除き、`openid` なしの本番scopeも受け付けます。PKCE、本人確認、最大30日の期限、resource一致、clientへの束縛、refresh時の失効・現在のアクセス権検証は維持します。token交換とrefreshには同じ `resource=https://slowth.1000ri.jp/api/mcp` が必要です。

複数project同意では現在閲覧できる対象の固定snapshotを保存し、書き込みとAI作業はそれぞれ個別同意を必要とします。ClaudeではChatGPT用の通知同意・通知接続・購読を作りません。初回401は読み取りに必要なscopeを提示し、書き込みは追加の明示同意です。既存Claude grantにscopeが不足する場合はHTTP 403と `WWW-Authenticate` で追加同意を要求します。ChatGPT用の既存toolエラー応答は保持します。既存ChatGPTのgrant・購読は変更しません。ローカルPAT接続は [別の接続方式](../tools/slowth-mcp/README.md) です。実クライアントの接続成功は、配備後の本人確認と区別して記録します。

書込は共有サービスのトランザクション内で行います。古い版を拒否し、同じ操作ID・同じ内容の再送では保存済みの結果を返します。一括操作の途中失敗は、成功済み・失敗・未実行を区別して返します。投稿者・確認回答者・記録時刻・導出値を任意の入力から偽造することはできません。

Dot は `coordination.propose` に理由と仕事の分解を保存し、実際の子タスク・担当・前提を保存した後で有効化します。利用可能な能力で着手し、成果・検証結果を親へ添付して、人間の確認を待ちます。人間の実回答を `sync_human` で同期し、修正時は新しい実行版へ進みます。AI の確認代行は拒否します。計画の完了と通常の親タスクの完了は別です。

### Muse（Meta Agent）の手動登録接続

`SLOWTH_MCP_OAUTH_MUSE=true` で固定public client `slowth-muse` を登録します。本番OAuthモードでのみ有効です。既定値は`false`です。2026-10-23のユーザー承認により`apphosting.yaml`で`true`を設定し、Muse接続を有効にします。任意clientの動的登録は行いません。

配備・有効化後、MuseのカスタムMCP接続に以下を設定します。

| 項目 | 値 |
| --- | --- |
| MCP URL | `https://slowth.1000ri.jp/api/mcp` |
| Client ID | `slowth-muse` |
| Client Secret | 空欄（public client、`token_endpoint_auth_method=none`） |
| Redirect URI | `https://agent.meta.ai/api/hatch/oauth/callback` |
| Authorization URL（手動設定時） | `https://slowth.1000ri.jp/api/oidc/auth` |
| Token URL（手動設定時） | `https://slowth.1000ri.jp/api/oidc/token` |
| Scope（読み取り） | `events:read tasks:read openid offline_access` |
| Scope（読み書き） | `events:read tasks:read tasks:write openid offline_access` |

戻り先はユーザーから提示された上記URLとの完全一致のみを許可します。PKCE S256と`resource=https://slowth.1000ri.jp/api/mcp`が必須で、token交換・refreshにも同じresourceが必要です。`openid`を送らない要求も受け付けますが、`events:test`や未知scopeとの混在は拒否します。本人のGoogleログイン、新しい明示同意、現在のメンバー権限、最大30日の期限、refreshのローテーション・失効検証を使用します。ChatGPT用の通知接続・購読は作成しません。

この追加はリモートOAuth MCPの認証・同意だけに適用します。REST APIとローカルstdio MCPは従来のPAT認証と共有タスク処理を使用します。ローカルの認可・token交換・refresh・同意画面検証と、Muse実サービスでの接続成功は区別します。本番配備後、Museから認証を開始し、読み取り・追加書込同意を本人が確認する必要があります。Muse側の必須認証方式がpublic clientと異なる場合は、その要求を確認してから対応します。

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

参照：[Claude公式の認証要件](https://claude.com/docs/connectors/building/authentication)、[Keycloak公式のDesktop client説明](https://www.keycloak.org/securing-apps/mcp-authz-server#_claude_desktop_integration)。hosted public metadataの現在のJSON取得は実行環境のCONNECT proxy 403で未確認です。固定client識別子とcallbackを相互交換する要求は拒否し、metadata取得先を任意URLへ開放しません。
