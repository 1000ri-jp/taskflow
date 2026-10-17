# Slowth ローカル MCP サーバー（Claude 用）

Claude Code や Claude Desktop から Slowth（https://slowth.1000ri.jp/）のプロジェクトとタスクを操作するための stdio MCP サーバーです。既存の個人アクセストークン（`tf_`）の REST API（[docs/API.md](../../docs/API.md)）を呼びます。

このローカルサーバーは本番の `/api/mcp`（OAuth）を使いません。依存パッケージはなく、Node.js 20 以上だけで動きます。Claudeアプリ・Claude Code向けリモートOAuthの実装・有効化条件は [MCPの説明](../../docs/SLOWTH_MCP.md#claudeアプリとclaude-codeのリモート接続) を参照してください。

## ツール

| ツール | 内容 | API |
| --- | --- | --- |
| `list_projects` | 見えるプロジェクト一覧 | `GET /api/projects` |
| `get_project_status` | 件数とリスト別進捗 | `GET /api/projects/{id}/status` |
| `list_lists` | リスト（列）一覧。作成・移動の `list_id` に使う | `GET /api/projects/{id}/lists` |
| `list_tasks` | アーカイブ以外のタスク。`list_id`・`completed`・`query`・`limit` で絞り込み（手元で処理） | `GET /api/projects/{id}/tasks` |
| `create_task` | タスク作成 | `POST /api/projects/{id}/tasks` |
| `update_task` | 部分更新（移動・完了・期限・担当など） | `PATCH /api/projects/{id}/tasks/{taskId}` |
| `add_task_comment` | コメント投稿 | `POST .../tasks/{taskId}/comments` |
| `archive_task` | アーカイブ（論理削除） | `DELETE .../tasks/{taskId}` |
| `restore_task` | アーカイブから復元 | `POST .../tasks/{taskId}/restore` |

実際に何ができるかは、トークンの権限・対象プロジェクト・プロジェクトでのロールで決まります。viewer は書き込めません。

## 1. トークンを作る

Slowth にログインし、**設定 → API キー**（`/settings/api-keys`）でトークンを作成します。

- 権限: 読むだけなら `projects:read` と `tasks:read`、作成・更新もするなら `tasks:write` を追加
- 対象プロジェクトは必要なものだけに絞るのがおすすめです
- 表示名（例: `Claude`）とアイコンを設定すると、Slowth 上で「◯◯ via Claude」と表示されます

`tf_...` で始まる文字列は一度しか表示されません。リポジトリや共有ファイルには保存しないでください。

## 2. Claude に登録する

このリポジトリを手元に clone し、`server.mjs` の絶対パスを指定します。

### Claude Code

```sh
claude mcp add slowth --scope user \
  --env SLOWTH_API_TOKEN=tf_xxxxxxxx \
  -- node /path/to/taskflow/tools/slowth-mcp/server.mjs
```

`claude mcp list` で `slowth` が `connected` になれば完了です。

### Claude Desktop

設定 → 開発者 → 構成を編集 で `claude_desktop_config.json` を開き、以下を追加して再起動します。

```json
{
  "mcpServers": {
    "slowth": {
      "command": "node",
      "args": ["/path/to/taskflow/tools/slowth-mcp/server.mjs"],
      "env": { "SLOWTH_API_TOKEN": "tf_xxxxxxxx" }
    }
  }
}
```

## 環境変数

| 変数 | 必須 | 既定値 |
| --- | --- | --- |
| `SLOWTH_API_TOKEN` | はい | なし（`tf_` で始まる値のみ受け付けます） |
| `SLOWTH_BASE_URL` | いいえ | `https://slowth.1000ri.jp`（ローカル開発時は `http://localhost:3000`） |

## 使い方の例

- 「Slowth のプロジェクト一覧を見せて」
- 「◯◯プロジェクトの未完了タスクを期限順にまとめて」
- 「◯◯プロジェクトの ToDo リストに『請求書送付』を来週金曜期限で追加して」
- 「このタスクを完了にして、コメントで結果を残して」

## テスト

```sh
npm run slowth-mcp:test
```

架空のトークンと架空の API サーバーだけを使います。実データには接続しません。

## claude.ai のカスタムコネクタについて

claude.ai（ブラウザ・モバイル）のカスタムコネクタは、このローカルstdioサーバーを直接使えません。Claudeアプリのhosted connectorは `/api/mcp` のOAuth接続を使います。`SLOWTH_MCP_OAUTH_CLAUDE=true` の配備・有効化と本人の明示同意が必要です。使い方・固定client/callbackは [MCPの説明](../../docs/SLOWTH_MCP.md#claudeアプリとclaude-codeのリモート接続) を参照してください。
