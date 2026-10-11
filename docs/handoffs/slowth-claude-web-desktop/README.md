# Slowth MCP: Claude Web / Desktop 接続の Mac 引き継ぎ

目的は、Claude Web / Desktop から `https://slowth.1000ri.jp/api/mcp` に接続できるようにすることです。配備環境はユーザー指定の「元の Mac」です。このブランチに実装、テスト、接続文書、受け渡し用のパッチと検証記録を保存しています。Claude Code 向けの変更とは別です。

## 取得元と状態

- リポジトリ: `1000ri-jp/taskflow`
- ブランチ: `codex/slowth-claude-web-desktop`
- 基準コミット: `b31764aa7009a696dca3c6b5810a1e8aa398116c`
- 実装コミット: `0e7bf857775744b55c8a918fd989052b98b0f036`
- パッチ: `docs/handoffs/slowth-claude-web-desktop/slowth-claude-mcp.patch`
- 検証記録: `docs/handoffs/slowth-claude-web-desktop/slowth-claude-mcp-verification.json`

実装と関連検証はクラウドで完了しました。本番配備、Googleログイン、実際のClaudeでの接続確認は未実施です。クラウドからMacを操作する接続、本番GCP認証、私有動画はありません。元のMacで配備と実接続確認を継続します。

Macに同じ名前のファイルが既に保存されている、という前提はありません。以下の取得方法で、実際の保存先を作成できます。

## Macでの取得

まず実際の作業ディレクトリの `AGENTS.md`、`git status --short --branch`、現在のHEAD、リモート名と配備元を確認してください。過去の文書にある `/Users/kozue/taskflow` とNeo/UI作業ツリーは、現在の配備元を特定する根拠として再確認が必要です。既存の未コミット変更・ブラウザ下書き・私有資材を保持します。

実際のGitリモート名を使い、このブランチをfetchします。次の例はリモート名が `origin` の場合です。

```sh
git fetch origin refs/heads/codex/slowth-claude-web-desktop
git show FETCH_HEAD:docs/handoffs/slowth-claude-web-desktop/README.md
```

現在の作業ツリーを切り替えずに、パッチと検証記録だけをMacの新規一時ディレクトリへ取り出す場合は、上記fetch直後に次を実行できます。既存ファイルの上書きを避け、最後に実際の保存先を表示します。

```sh
taskflow_handoff_dir=$(mktemp -d "${TMPDIR:-/tmp}/slowth-claude.XXXXXX")
git show FETCH_HEAD:docs/handoffs/slowth-claude-web-desktop/slowth-claude-mcp.patch > "$taskflow_handoff_dir/slowth-claude-mcp.patch"
git show FETCH_HEAD:docs/handoffs/slowth-claude-web-desktop/slowth-claude-mcp-verification.json > "$taskflow_handoff_dir/slowth-claude-mcp-verification.json"
git show FETCH_HEAD:docs/handoffs/slowth-claude-web-desktop/README.md > "$taskflow_handoff_dir/README.md"
printf '%s\n' "$taskflow_handoff_dir"
shasum -a 256 "$taskflow_handoff_dir/slowth-claude-mcp.patch"
```

パッチのSHA256は次の値です。

```text
d9b10bf12d2fd21aac401322de9dcddbb4e82f19ac09d071c60e1ceb76a1cdf7
```

このブランチにはパッチの変更を適用した実装もコミットしています。実装コミットだけを取り込む方法も選べます。ブランチの実装を取り込んだ場合、同じパッチを再適用する必要はありません。別の配備元へパッチで取り込む場合は `git apply --check` を先に実行し、基準が違う場合は実際の差分を突き合わせます。適用失敗に対してforce、reset、既存作業の破棄を使いません。

パッチには新規ファイル4件を含む27ファイルの実装・テスト・接続文書を収録しています。上記コミットを展開した一時ディレクトリで適用チェック・適用・クラウド作業ツリーとのバイト一致を確認済みです。検証JSONの `files` には変更後の各ファイルSHA256を記録しています。鍵・実トークン・`.env`・私有動画・ワーカーの稼働状態は含めていません。

## 実装した内容

- Claudeの公開OAuthクライアントを動的登録し、PKCE S256を要求する。
- コールバックを `https://claude.ai/api/mcp/auth_callback` と `https://claude.com/api/mcp/auth_callback` の完全一致に制限する。
- 標準OAuth / OpenID検出経路を提供する。
- 登録クライアント、同意、token、更新履歴のクライアント対応を検証する。
- Claudeの名前と権限を同意画面に表示し、設定画面と接続文書を更新する。
- 既存ChatGPT接続、承認済みGoogleアカウント・プロジェクト、失効とメンバー権限の再確認を維持する。

Claudeは `list_task_updates` で更新履歴を取得します。既存のChatGPT / Dot通知コールバックは同じ設定を使用します。詳しくは `docs/SLOWTH_MCP.md` を参照してください。

## 検証済みの範囲

クラウドで関連9ファイル / 283テスト、型チェック、lint（UIガイド34標本を含む）、MCP契約・Functions生成と構文検査、差分の空白検査が成功しました。最後の標準メタデータ経路修正後、影響するプロバイダーの18テストを再実行し成功しています。

```sh
npm run test:run -- src/lib/mcp src/app/api/mcp src/app/mcp-connect/consent.test.tsx
npx tsc --noEmit
npm run lint
npm run mcp:check
git diff --check
```

実際のNext.jsを起動し、標準OAuth / OpenIDメタデータ、既存issuerメタデータ、未認証MCP POSTの401と認証メタデータ案内、MCP GETの405をHTTPで確認しています。ローカルの模擬設定での検証です。本番Firestore、実際のGoogle / Claudeアカウント、完全な本番ビルドは未確認です。

Macはリポジトリ指定のNode.js 22を使用します。クラウドでの実行環境はNode.js 24.19でした。必要な依存関係はlockfileに従い `npm ci` で準備します。

## Macでの配備準備と反映

1. 実際の配備元・本番設定を確認し、既存作業と本番機能を保持して変更を取り込む。
2. `docs/PRODUCTION_SOURCE_PRESERVATION.md` と `docs/HELP_VIDEO_ASSETS.md` に従い、私有保全コピーからカタログ指定の動画13本を `src/assets/help-videos/` へ供給する。
3. `npm run release:prepare -- /私有領域/新規候補ディレクトリ` でリポジトリ外の新規候補を作成する。生成した `manifest.json`、Git状態、差分を保存し、候補の `source/` で依存関係と `npm run build`、必要な配備検証を確認する。
4. `docs/FIREBASE_APP_HOSTING_RELEASE.md` と既存の本番反映手順に従って候補からApp Hostingへ反映する。プロジェクトは `projectmanager-e3308`、backendは `taskflow`。コマンドは `firebase deploy --only apphosting:taskflow --project=projectmanager-e3308`。
5. 変更を取り込んだ元のリポジトリから既存 `slowth-mcp-events` Functionsを別途反映する。非秘密パラメータ `SLOWTH_MCP_OAUTH_CLAUDE_ENABLED=true` と既存の各設定・Secret参照を保持する。

App Hosting用フラグは `apphosting.yaml` にtrueを追加済みです。Functions側の同フラグは既定falseのため、Claude用の更新履歴を保存する配備先ではtrueを指定してください。`.env.example` で既存の実設定を上書きしません。

Functionsは既存の `slowthCaptureTaskChange`、`slowthCaptureTaskDetailChange`、`slowthDeliverTaskChange`、`slowthRetryTaskChanges` の4関数です。App Hostingの候補はFunctionsソースを含まないため、Functionsは元のリポジトリの `firebase.json` と既存CLI設定に従って対象を明示して反映します。`predeploy` は共有ライブラリ生成と構文検査を行います。

裸の `firebase deploy` は使わず、この変更と無関係なRules、Indexes、IAM、Macワーカー設定の配備を混在させません。mainへのpush / mergeで配備が起動する場合は、私有動画の供給を確認してから進めます。

2026-10-10 JSTの記録では本番は `taskflow-build-2026-10-08-003` でした。現在のmainと本番は完全には同一ではありません。以前の本番ソースでmainの認可強化を上書きせず、実際に反映する候補を確認してください。

## 実際の接続確認

1. App Hosting build / rolloutの完了と、`https://slowth.1000ri.jp/.well-known/oauth-authorization-server/api/oidc` の登録・認可・token endpoint、MCPの未認証応答を確認する。
2. Claude Webの「設定 → コネクタ」で名前 `Slowth`、URL `https://slowth.1000ri.jp/api/mcp` のカスタムコネクタを追加する。client ID / secretの手入力は不要。
3. 許可済みGoogleアカウントでログインし、「Claudeとの接続確認」でプロジェクトと権限を確認して許可する。登録、PKCE認可、token交換とDesktopからの利用を確認する。
4. `get_task_contract`、`read_task_data` でタスク・コメント・添付を読み、既存ChatGPT / Dot接続も確認する。コメント添付は `resource=comments` の各コメント内にあり、本体は `resource=attachment_content` で取得する。chunkは最大32,768バイト、`next_offset` がnullになるまで読み、base64をデコードして結合する。
5. 配備元のコミット、差分・manifestとApp Hosting build / rollout、Functionsの反映結果、Claude Web / Desktopと既存接続の実測を記録する。ユーザーのログイン操作待ちや未実施の項目は確認済みとは扱わない。
