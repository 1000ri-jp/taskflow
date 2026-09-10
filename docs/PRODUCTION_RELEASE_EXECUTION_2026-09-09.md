# 本番反映実行記録（2026-09-09）

対象手順書：[本番反映手順書](PRODUCTION_RELEASE_RUNBOOK_2026-09-07.md)

## 判定：No-Go（本番変更前に停止）

ユーザーの本番反映依頼に基づき事前確認を実施。main WT `/Users/kozue/taskflow` のみを使用した。本番ルール配備、DB書き込み、バックアップ取得、import、push、PR作成、アプリ配備は実施していない。

### 確認できた状態

- 対象HEAD：`a91da99283b1ed7b28a5cf1d1885300009a4177b`。
- `git fetch upstream` 後のリモートmain：`af3b7c010d95bb04fad14d5cbfdef372fbac6108`。対象は6コミット先。
- GitHubの最新の `Production – taskflow` Deployment記録：`5466431918`、SHA `af3b7c010d95bb04fad14d5cbfdef372fbac6108`、2026-07-16作成、status `success`、URL `https://taskflow-hlf6wlutj-1000ri.vercel.app`。これはGitHub記録であり、現在のVercel本番エイリアス・接続先・ロールバック可否の実査は未完了。
- GitHub main保護：PR経由、必須チェック audit / lint / test / build / e2e-smoke、strict有効。production Environmentのprotection_rulesは空。
- リポジトリとproduction Environmentの `gh variable list` / `gh secret list` は空。組織から共有される設定やVercel Git連携の実態は未確認。Actionsによる配備が可能とは判定できない。
- 直近CI `34092309725` は比較元SHAに対する実行。audit失敗、lint/test/build/e2e-smoke成功。対象HEADのCI成功証拠には使わない。
- ローカルのFirebase CLI・Vercel CLIはPATHに存在せず、`.vercel/project.json` もない。

### 本番DB確認の阻害要因

アクティブなgcloudアカウント `kozue@1000ri.jp` で、候補プロジェクト `projectmanager-e3308` に対して以下を読み取り実行した。

- `gcloud firestore databases describe --project=projectmanager-e3308 --database='(default)'`：PERMISSION_DENIED。
- `gcloud storage buckets list --project=projectmanager-e3308`：403、`storage.buckets.list` 権限不足（または対象不存在）。

このため、対象の本番接続先との一致、DBロケーション、現行ルール、Storage保全、バックアップ先、隔離復元を確認できていない。別アカウントへの切替やIAM変更は行っていない。

### ローカル検証結果

実行環境：Node `v24.7.0`、npm `11.5.1`。CIのNode 20とは異なるため、最終CIの代替ではない。

| コマンド | 結果 |
| --- | --- |
| `npm ci` | 成功。package.json / package-lock.jsonの変更なし |
| `npm run audit` | 失敗、exit 1。optional除外後19件（low 6 / moderate 6 / high 6 / critical 1） |
| `npm run lint` | 成功 |
| `npm run test:run` | 90ファイル・561テスト成功 |
| `npx tsc --noEmit --pretty false` | 成功 |
| build / e2e-smoke | 今回未実施。必須auditとDB開始条件が不成立のため、リリース合格扱いにしない |
| DB・ルール・隔離復元試験 | 未実施 |

auditのcritical対象はNext.js。high対象にはPostCSS、undici、brace-expansion、browserslist、js-yaml、nanoidを含む。監査結果の件数は依存パッケージ単位であり、アプリで各脆弱性が悪用可能と断定するものではない。ただし手順書の必須チェックは不合格。`npm audit fix` や依存更新は実施していない。

### 再開条件

1. 本番のVercel Project・現行Deployment・エイリアス・Firebase設定を読み取り確認できるアクセスを確保する。
2. 正しいGoogle Cloudプロジェクトに対するDB・Storage・ルールの確認とバックアップ／隔離復元に必要な権限を確保する。資格情報の秘密値を文書やチャットに保存しない。
3. 利用停止時間帯、クライアントとAdminの書き込み停止方法、バックアップ先、隔離復元先、テスト担当者、viewerの運用要件を確定する（ユーザーへ照会済み）。
4. 依存関係の監査不合格を解消し、変更後のSHAで必須CIを再実施する。手順書§5の日付逆転・重複作成・部分更新等の合格表も検証し、不合格は修正する。
5. 手順書§2〜6の証拠が揃ってからGo判定し、Firestoreルール→PR経由main反映→アプリ配備→本番スモークの順に進む。

既存の未コミット手順書と `docs/DEPLOYMENT.md` の編集は保持している。今回追加した実行記録も未コミット。

## 追記：権限解消とバックアップ保存先の準備

2026-09-09、ユーザーによる権限追加後、同じアカウントでFirestore情報・Storage一覧の取得に成功。上記403は解消済み。Firestoreは `(default)` / `asia-northeast1`、PITR無効。既存Storageは `projectmanager-e3308.firebasestorage.app` / `US-CENTRAL1`、soft delete 7日。

IAM testIamPermissionsで `datastore.databases.export`、`datastore.operations.get`、Storageのget/list/create、バケット作成権限を確認。Firestoreサービスエージェントに `roles/firestore.serviceAgent` の付与を確認した。実export成功の証明ではない。

ユーザーの「進めてください」に基づき、課金有効を確認して2026-09-09 07:00 UTC頃に次の専用バケットを作成した。

- URI：`gs://projectmanager-e3308-taskflow-backups-681619367832`
- プロジェクト：`projectmanager-e3308`
- ロケーション：`ASIA-NORTHEAST1`（東京）
- Public Access Prevention：`enforced`
- Uniform bucket-level access：有効
- Soft delete：7日
- 作成後のdescribeとIAM取得で確認。作成時の標準IAMにはプロジェクトOwner/Editor/Viewer向けのlegacyバインディングがある。公開アクセスは防止しているが、バックアップ担当者だけに限定したIAMではない。

作成したのは空の保存先のみ。Firestore export・Storageコピー・本番ルール変更・配備は未実施。手順書§6.2の利用者とAdmin/外部連携の書き込み停止、隔離復元先の確定は未完了のため、リリース用バックアップの開始条件は未成立。audit不合格等の既存No-Go条件も残る。

## 追記：即時バックアップ取得完了

上記は保存先作成時点の記録。その後のユーザー指示「今すぐやって」に基づき、稼働中の保全用バックアップを取得した。書き込み停止の技術的確認は行えていないため、§6.2を満たすリリース用の整合した同一時点バックアップとは扱わない。

- 共通保存先：`gs://projectmanager-e3308-taskflow-backups-681619367832/taskflow/backup-20260909-now/`
- Firestore：`firestore/`。コレクション指定なしの全体export。
- 開始：2026-09-09 16:01:18 JST。完了：16:02:01 JST。
- operation：`projects/projectmanager-e3308/databases/(default)/operations/ASBmNjQzMWZkOTUzZmQtNGFmOS1mZGM0LTYxYjctZmY5NjNjNTMkGnNlbmlsZXBpcAkKMxI`
- 結果：`done: true` / `SUCCESSFUL`、3,607ドキュメント、3,072,886バイト（operationのcompletedWork）。
- Storage：既存バケットから `storage/` へrecursive rsync、exit 0。削除同期オプションなし。
- Storage検証：recursive / checksums-only / dry-runで元・先とも162件を列挙し、コピー予定なし。照合時点の現行オブジェクトを保全。過去世代やsoft-deletedオブジェクトの全履歴をコピーしたものではない。

本番のドキュメント・添付・ルールは変更せず、バックアップ先への保存のみ実施した。隔離復元リハーサル、設定類の保全、本番接続先の照合、CI不合格解消は未完了。本番反映のNo-Go判定は継続。

## 追記：Firebase App Hostingへ配信先変更

ユーザーからVercelではなくFirebaseでホストする指示を受領。[Firebase用追加手順](FIREBASE_APP_HOSTING_RELEASE.md)を作成し、`firebase.json` と `apphosting.yaml` を準備。旧Vercel配備ワークフローはローカルで削除したが、まだpushしていない。

依存関係を修正：PostCSS overrideを8.5.28に変更し、npm 11.11.0で既存semver範囲のaudit fixを実施（forceなし）。通常npm 11.5.1のaudit fixは内部エラーだったため切替。更新後の必須auditは0件・lint成功・build成功・単独再実行の561テスト成功。通常npm ciのoptional込みではmoderate 8件が残る。

本番Firestoreルール取得時の403はquota projectヘッダー指定で解消。現行との差分がマイルストーンmatch追加のみと確認。新ルールは未配備。

- 現行Firestore ruleset：`025dc5fc-3110-4d2c-9b28-d672168594de`
- 現行Storage ruleset：`78f50358-8ef2-44e6-a8b2-5521630c824f`
- 設定バックアップ：既存バックアップURI配下の `config/taskflow-release-config-20260909/` にreleasesとルールJSON等4ファイルを保存済み。

App Hostingのバックエンド・build・rollout作成権限はIAM検査で確認したが、APIは無効。`gcloud services enable firebaseapphosting.googleapis.com` は `serviceusage.services.enable` 不足で失敗。APIの有効化を管理者に依頼済み。プロジェクトでの `iam.serviceAccounts.actAs` も検査結果に含まれず、実行サービスアカウント単位の権限は未確認。Firebase CLIは未ログイン。現段階で新しいホスティングのバックエンド・公開URLは作成していない。

Next.js 16.3.4のdev起動によってAGENTS.mdとCLAUDE.mdが新規生成された。手動で追加した業務指示ではない。変更はすべてmain WTに未コミットで保持。

## 追記：App Hosting API有効化後の初期設定

ユーザーによる有効化後、App Hosting APIのlocations/backends取得に成功。バックエンドは0件。関連するDeveloper Connect、Cloud Build、Secret Manager、Cloud Run、Artifact Registry、IAM APIも有効。東京はApp Hostingの選択肢になく、今回の作成先は利用可能なアジアの `asia-east1`（台湾）とした。Firestoreは東京のまま。

gcloudの短期アクセストークンを環境変数経由でFirebase CLIへ渡し、quota projectを指定して認証できた。永続的なサービスアカウント鍵は発行していない。

`taskflow` バックエンドを既存Web Appに関連付け、Node.js 22で作成を試行したが、実行用 `firebase-app-hosting-compute@projectmanager-e3308.iam.gserviceaccount.com` 不存在により400で失敗。続くgcloudのアカウント作成も `iam.serviceAccounts.create` 不足で失敗。バックエンドは未作成、アプリ・ルールは未配備。

現在の配備者 `kozue@1000ri.jp` のIAM検査では `serviceusage.services.enable` と `resourcemanager.projects.setIamPolicy` は許可され、`iam.serviceAccounts.create/get/actAs/setIamPolicy` は許可されていない。実行アカウント作成と利用の権限追加が次の阻害要因。配備者自身への権限追加は実施していない。

## 追記：Firebase App Hosting初回公開完了

サービスアカウント作成者・ユーザー権限の追加後、バックエンド作成が成功。`firebase-app-hosting-compute@projectmanager-e3308.iam.gserviceaccount.com` に標準のSDK Admin Service Agent・computeRunner等のロールが付与されたことを確認。

1. FirestoreルールのみをCLIで配備。コンパイル成功後、APIから有効ルールを再取得してmainのファイルと完全一致を確認。
   - 新ruleset：`6097dec5-80cf-4407-854b-10124919737c`
   - SHA-256：`5b82da97a1b864b8d57fbd7ebc1df78f54599f23e5b3b3a728f708d136f93979`
   - 変更はマイルストーンmatch追加のみ。データ移行・既存ドキュメント更新なし。
2. 設定と依存更新をmainにローカルコミット `f0613d9`。pushなし。
3. App Hostingのみを配備。ソース：`gs://firebaseapphosting-sources-681619367832-asia-east1/taskflow--39939-tX71ftr2KCLI-.zip`。
   - ZIP SHA-256：`bb813155d91f57fbd69c860e867d6675b89fc2baab7b720395f04cb1b14bd9f4`
   - 381エントリ。`.env.local`・`.env`・`.git`・node_modules等は含まず。Git管理済み `.env.local.example` は.gitignore例外により含まれる。主要設定・lockfileが配備コミットと一致すると確認。
4. Cloud Build `84e18b4a-3f0a-4e6e-b503-c68285a68fd7` SUCCESS、App Hosting `build-2026-09-09-001` のbuild READY / rollout SUCCEEDED。16:25 JST頃完了。
5. 公開URL：`https://taskflow--projectmanager-e3308.asia-east1.hosted.app`。Authの許可ドメインへ追加し、既存ドメインの保持を確認。変更前の一覧は `config/taskflow-release-config-20260909/auth-domains-before-apphosting.json` に保全済み。
6. ログインページ200、未認証API2経路401、テスト認証無効、直近Cloud Run ERRORなしを確認。Codex内ブラウザのGoogleログインが通信エラーとなり、通常ブラウザでユーザー確認を依頼。

公開処理は完了したが、ログイン後の実業務・DB操作スモークと復元検証は未完了。旧Vercelサイト・DNSは変更していない。

### ユーザー確認

公開後、ユーザーから「ログインできています」と回答を受領。通常ブラウザでのGoogleログイン成功を確認済みとして記録する。App Hostingへの公開とログイン確認は完了。共有DBへのテスト書き込み、全業務操作の回帰、隔離復元は実施していない。
