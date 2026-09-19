# TaskFlow 本番反映手順書（2026-09-18）

## 目的と適用範囲

この手順書は、Firebase App Hosting で稼働する TaskFlow に、現在の `main` が含む Neo AI 秘書・自動化・Google Workspace 連携と関連する Firestore 変更を反映する場合の準備・実行・復旧手順です。本書の作成自体は本番反映の許可や Go 判定ではありません。

既存の [2026-09-07版手順書](PRODUCTION_RELEASE_RUNBOOK_2026-09-07.md) は、マイルストーン機能中心の旧候補を扱い、Vercel の記述も残っています。今回の Rules・Indexes 差分や App Hosting の前提を確認せずに、そのまま実行しないでください。

### 本書作成時に確認した状態

| 項目 | 確認できた記録 | 実行日に必要な確認 |
| --- | --- | --- |
| 作業対象 | `/Users/kozue/taskflow` の `main`。HEAD `a9600b6cd8992041b83f09eea426374fafb331fb`、作業ツリーは clean | `git fetch` 後、リモート `main`、保護ルール、最終レビュー済み SHA と一致させる |
| ローカル比較元 | 保存済み `upstream/main` より11コミット先 | 保存済み参照は最新リモートの証拠ではない。差分の内容と配信先の接続設定を更新する |
| 最終記録の App Hosting 配備 | 2026-09-09、ソース `f0613d9`、backend `taskflow` / `asia-east1`、rollout `build-2026-09-09-001` | これが現在の稼働版か、Console/API で稼働 SHA・URL・Build・Rollout を再取得する |
| 公開URL | `https://taskflow--projectmanager-e3308.asia-east1.hosted.app` | 実際の利用URL、独自ドメイン、Auth 許可ドメインと一致するか確認する |
| 最終記録の Firestore | `(default)` / `asia-northeast1`、PITR 無効 | DB ID・場所・PITR・バックアップ方針を再取得する |
| 最終記録の Storage | `projectmanager-e3308.firebasestorage.app` / `US-CENTRAL1`、soft delete 7日 | 実バケット・世代管理・soft delete・現行ルールを再取得する |
| 配信方式 | 初回は Firebase CLI のローカルソース配備 | App Hosting の Git 接続・自動 Rollout が後から設定されていないか確認する |

上記は過去の記録です。最新の本番状態を確認できるまでは、本番反映は No-Go です。

## 1. 変更の範囲と DB への影響

アプリ配備だけで全機能を動かすものではありません。新しいデータは既存 Firestore に機能利用時に作られます。全件スキーマ移行や本番 seed をこの手順に追加しません。

| 保存先 | 用途・変更 | 復旧時の注意 |
| --- | --- | --- |
| `projects/{projectId}/tasks/{taskId}` | 自動確認結果、`automation`、`completionPolicy`、`autoArchiveCompletedAt`、`reviewRequests` など。共有完了・期限・アーカイブも機能の明示許可後に更新される | 旧アプリへの切替では値は戻らない。新フィールドの削除や全件巻き戻しをしない |
| `users/{uid}/secretary/state` | 個人の AI 提案、判断、限定された Gmail/Chat 確認候補など | Firestore Rules でクライアント直アクセスを許可しない。Admin API の認証・ユーザー分離も試験する |
| `users/{uid}/secretary/task-automation` | 自動確認の本人別許可、根拠、履歴、通知状態。`secretary.automationEnabled` の collection-group query がある | 個人許可を共有許可と混同しない。Scheduler 未設定でも画面利用中の処理は別途確認する |
| `projects/{projectId}/settings/autoArchive`、`autoArchiveRun` | 明示保存された共有自動アーカイブ設定と実施記録 | 初期値 OFF を確認する。設定・実施記録はコード切替では戻らない |
| `projects/{projectId}/activityLogs`、`notifications`、task/comment 子コレクション | AI・確認・注文報告・自動化の履歴と通知。追加 Indexes は `activityLogs` と `secretary` | 関連文書を一組として照合する。受領記録や通知だけを個別に消さない |
| `googleWorkspaceConnections/{namespace}/users/{uid}` | サーバー管理の OAuth 接続情報。トークンは user/environment に結び付けて暗号化保存 | `GOOGLE_TOKEN_ENCRYPTION_KEY` の Secret Manager version を保全する。鍵変更・紛失で既存トークンは復号できず、再接続が必要になる |
| `googleWorkspaceSnapshots/{namespace}/users/{uid}` | 選択した Calendar/Gmail/Chat のキャッシュ。Gmail/Chat 抜粋は個人情報を含み得る | namespace を分ける。開発用 namespace の文書・トークンを本番 namespace にコピーしない |
| Firebase Storage | 添付等のバイナリと Firestore 内の参照 | Firestore export には含まれない。DB と別の保全・照合が必要 |

### Rules・Indexes の差分

`f0613d9` の記録済み配備から現行 `main` までに、`firestore.rules` と `firestore.indexes.json` の差分があります。

- Rules はユーザー設定の一部、プロジェクト共有設定、タスク作成・更新、確認依頼コメントの書き込み条件を変更し、クライアントが直接変更できないサーバー管理項目を定義しています。ルール一式の配備は本番の有効 Rules 全体を置き換えるので、既存の本番専用条件を比較なしで上書きしません。
- Indexes は `activityLogs` の複合 Index と `secretary.automationEnabled` の collection / collection-group Index を追加しています。新機能利用前に本番側の Index が `READY` であることを確認します。既存 Index の削除・不足が見つかったら、この候補に含めず別途判断します。
- `storage.rules` はこの候補差分では変更されていません。ただし現行ソースは `projects/{projectId}/...` を許可ドメイン単位で広く許可し、Firestore のプロジェクト参加者制限とは同じ境界ではありません。添付を参加者限定にする要件なら、Storage Rules の見直しと試験が完了するまで No-Go です。
- Firestore Security Rules は Admin SDK によるサーバー書き込みを制限しません。直接クライアントの許可・拒否試験と、API 側の認証・認可・トランザクション試験を分けます。

### Google Workspace と自動実行の条件

現行 `apphosting.yaml` には Google OAuth の Secret 参照や Cloud Run Job の秘密値がありません。Google 接続を本番で有効にする場合は、`GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`GOOGLE_OAUTH_REDIRECT_URI`、`GOOGLE_TOKEN_ENCRYPTION_KEY`、`GOOGLE_WORKSPACE_NAMESPACE` を App Hosting 用に設定します。`GOOGLE_OAUTH_CLIENT_SECRET` と `GOOGLE_TOKEN_ENCRYPTION_KEY` は Secret Manager に置き、ID・redirect URI・namespace は公開設定として環境へ設定します。暗号鍵はコードが要求する64桁のhex（32 byte）を使い、production namespace と紐付けて安定運用します。App Hosting の Cloud Build と Cloud Run の両 service account が必要な Secret version を読めること、OAuth redirect URI・必要 API・許可 scope が承認済みであることを確認します。ホスト済み callback を追加する際は既存の Firebase/localhost callback を保持します。値そのものを Git、手順書、ログへ書かないでください。

候補実装の記録ではローカル検証用 namespace `local-bde4` を使って実アカウントを接続し、データ取得・個人状態保存まで検証しています。現在の Firebase にその名前空間の接続文書・スナップショット等が存在する前提で棚卸しし、実データの有無と保存先を確認してください。これは本番設定ではありません。消去は別の判断とし、本番 namespace と再利用・混合しません。新しい本番 namespace の接続は空から開始し、利用者が本番で接続し直します。

自動確認・自動アーカイブの不在時実行向け Cloud Run Job、Cloud Scheduler、`TASK_AUTOMATION_JOB_SECRET` は、現行運用資料では未作成です。今回それを同時に構築しない場合は Scheduler を作らず、`TASK_AUTOMATION_SCHEDULED` を有効にしません。構築する場合は Job・Scheduler・Secret・サービスアカウント・停止手順・隔離データ試験を別の作業として計画し、アプリ公開とは別に判定します。

## 2. No-Go 条件

次のどれかが残れば、Firestore Rules/Indexes、アプリ、OAuth 設定のいずれも本番へ反映しません。

- 実際の App Hosting URL、backend、現在の稼働 SHA、Firebase Project、Firestore DB/場所、Storage bucket を確認できない。
- 本番の最新 Firestore Rules / Indexes / Storage Rules と候補ファイルの差が説明できない。Rules の全置換で本番専用条件が失われる可能性がある。
- すべてのデータ書き込み元を特定・停止できない。通常の Firestore export は開始時の完全なスナップショットではなく、実行中の変更を含み得る。
- 直前バックアップが完了していない、または隔離先で Firestore を復元して内容を確認できていない。
- Firestore と Storage の保全状態、IAM の許可主体、保管期限を確認できない。承認された必要最小限の主体に絞れていない backup bucket は使わない。
- 業務上必要な RPO/RTO と保守時間に合う復旧策が決まっていない。PITR が無効なら、当日の export と隔離復元を確認しただけで継続的なバックアップ体制まで整ったとは扱わない。
- 現行・候補 Rules を隔離環境で試験していない。現在 `firebase.json` に Emulator 設定がない場合は、検証済みの隔離プロジェクトを用意するまで No-Go とする。
- 追加 Index が必要な経路で `READY` にならない、または本番の手動管理 Index が候補ファイルから欠落する。
- Viewer / Editor の必要な書き込み境界や添付ファイルのアクセス境界が未決定。
- 最終 SHA の必須 CI、DB 権限テスト、Admin API の認証試験、旧データ互換性試験に失敗または未確認がある。
- 実行者・確認者・障害時判断者・利用停止時間・復帰可能時間が決まっていない。
- Google Workspace を有効化するのに production 用 namespace / 暗号鍵 / OAuth 設定がない、またはローカル接続文書と混線する。
- 旧版 App Hosting Rollout への復帰が可能か確認していない。記録された以前の Build が期限切れ、削除済み、または再配備できない場合は代替を先に準備する。

## 3. 反映前チェック

### 3.1 作業状態と稼働版の固定

作業・コマンド実行は `/Users/kozue/taskflow` の `main` で行います。作業ツリーが clean でなければ変更を混ぜず停止します。リモート状態を更新し、次を作業記録へ保存します。

```sh
cd /Users/kozue/taskflow
git fetch upstream
git status --short --branch
git rev-parse HEAD
git log --oneline upstream/main..HEAD
```

本番の現在稼働 SHA、今回の最終 SHA、CI の `head_sha` が一致することを確認します。手順書だけを直したコミットを含む場合も最終 SHA を固定し、レビュー・CI 後にその SHA を使います。GitHub 保護を迂回する直接 push はしません。

Firebase Console で次も確認します。

- App Hosting backend `taskflow` の公開 URL、region、現在の Rollout / Build / source commit、使用中の Secret version と環境設定。
- App Hosting の Git 接続・ライブブランチ・自動 Rollout が現在有効か。GitHub 接続が有効なら、main 更新や PR merge が自動公開を開始しない方法を先に確認する。
- Firebase Auth のプロバイダーと承認済みドメイン、Google OAuth redirect URI、Cloud Run runtime service account と IAM。
- 実際に配備されている Firestore Ruleset、全 Index と状態、Storage Rules、Firestore・Storage の場所と保護設定。
- 過去の Firebase/Vercel URL が別に稼働している場合、利用者がどちらを開くかと障害時の案内方法。

`.firebaserc` の alias だけで本番 Project を選びません。すべてのコマンドで検証済み Project ID を明示します。

### 3.2 データ書き込み停止と変更凍結

作業時間帯を利用者に告知し、Firestore 直書きクライアント、Admin API、添付 Storage、OAuth 接続/切断、画面内自動処理、Cloud Run Job / Scheduler など、存在するすべての書き込み元を列挙します。現在 Job がないという過去の記録だけで、実行日に未設定とは判断しません。

1. 結果が不明な投稿を同じタブで確認し、未送信フォーム・下書きを保全する。
2. 記録上、全利用者共通の保守モードは確認できていません。全 TaskFlow 利用者へ編集停止を連絡し、各利用者の停止確認を取る。編集・添付・確認依頼・AI の採用/取消を止め、既知の App Hosting/API writer と worker の実行待ちが完了したことをログで確認する。
3. 一時的な拒否 Rules を使う場合は、現行 Rules と戻す手順を別に保全し、クライアント直書きを止める。その Rules は Admin SDK の書き込みを止めないため、Admin route、Job、Scheduler、外部処理も個別に停止する。
4. 停止確認後、Firestore/Storage の書き込み量と実行ログを確認し、進行中書き込みがないことを確認してから backup を開始する。確認窓で未把握の書き込みが続く、利用者全員の停止確認が取れない、または Admin/Scheduler の全経路が説明できない場合は No-Go にする。ルール変更だけで全 write を止めたと判断しない。

### 3.3 候補 SHA のテスト

最終 SHA に対する CI の `audit` / `lint` / `test` / `build` / `e2e-smoke` を確認します。再現が必要な場合は現在のスクリプトを使用します。

```sh
npm ci
npm run audit
npm run lint
npm run test:run
npx tsc --noEmit --pretty false
npm run build
npm run test:e2e:smoke
```

全テストが成功しても Rules・本番 Index・Firebase Admin の認可・外部 OAuth の成功証明にはなりません。次の DB 試験を別に通します。

#### DB / Rules / Index の隔離試験

- 現行本番 Rules と候補 Rules を隔離 Firebase project または検証済み Rules Emulator でそれぞれ試す。未ログイン、別ドメイン、非参加者、Viewer、Editor/Admin の read/write を期待結果と照合する。
- タスクの通常編集、`automation` / `completionPolicy` 等のクライアント直書き拒否、確認依頼 comment の作成・編集・削除、server-only 設定の拒否を試験する。
- personal secretary / Google Workspace 文書をクライアントから読めず書けないこと、本人の API では読めること、別 UID からは拒否されることを確認する。Admin API は Firebase Rules が適用されないため、認証・認可を個別に試験する。
- Storage Rules を現行・候補で試験する。プロジェクト外ユーザーが添付を読める/削除できる設計が要件どおりか確定する。
- 古いタスク・コメント・通知・チェックリスト・settings を含むデータで新版を試す。未知フィールドを消さない。旧版へ切り替えた場合に新しいデータを壊さないことも確認する。
- 新しい activityLogs / secretary のクエリを隔離環境で実行し、Indexes が作成され `READY` になるまで待つ。
- `local-bde4` を含む既存 Google 接続レコードは読み取り範囲・秘密値を露出させず、namespace の分離と復旧計画だけを確かめる。
- AI 提案生成は実 API 呼び出しと利用料を伴い得る。行うならテスト利用者・回数・対象データを合意し、仕事の採用や共有変更は隔離データで試す。

## 4. バックアップと隔離復元

2026-09-09 に記録された Firestore export / Storage コピーは過去時点の保全です。Firestore は3,607文書の export、Storage は当時の162オブジェクトをコピーしましたが、書き込み停止は記録されず、Storage の古い object version / soft-deleted object の全履歴も対象外で、隔離復元は未実施です。今回の復旧確認を代替しません。

### 4.1 対象を分けて保全する

- Firestore: 対象の `(default)` DB をコレクショングループ指定なしで全体 export。サブコレクションと新旧パスを含める。
- Storage: 対象 bucket の全現行オブジェクトを、削除同期をしない別の日時付き prefix へコピーし、件数・サイズ・チェックサム・必要な metadata と参照先を照合する。世代・soft-deleted object が必要なら、それを復旧できる別の保護策を確認する。
- 別途保全: Firestore Rules / Indexes、Storage Rules、Firebase Auth の許可ドメイン・OAuth redirect URI、App Hosting rollout/config、IAM、Secret Manager の Secret 名と version、Job/Scheduler の有無と設定。
- Firestore export は Auth ユーザー、Storage object、Rules、Indexes の代替保全ではない。export には `users/{uid}/settings/aiKeys`、暗号化 OAuth token、Gmail/Chat の限定 cache が含まれ得る。backup bucket は必要最小限の IAM・アクセスログ・保管期限を設定し、export 文書本文や Secret 実値をローカル、手順書、チャット、ログへ出さない。
- 2026-09-09 の実行記録にある `gs://projectmanager-e3308-taskflow-backups-681619367832` は Public Access Prevention と Uniform bucket-level access が有効でしたが、プロジェクトから Owner / Editor / Viewer の広い IAM binding を継承していました。Public Access Prevention は公開アクセスを防ぐ設定であり、最小権限を保証しません。現在の IAM を再確認し、承認済みの保管先で許可主体を必要な運用者・サービスエージェントに限定できるまで、この bucket へ新しい export を保存しません。既存バックアップは削除せず、移行が必要なら新しい保護先へコピー・検証してから扱います。
- export と Storage コピーは原子的な同一時点ではない。書き込み停止開始・終了、両方の開始/完了時刻、最終照合時刻を記録する。

### 4.2 Firestore export

作業日前に隔離 project、DB、IAM と保存 bucket の権限を確認します。バックアップ先は Firestore と同一または近い対応 location を選び、既存バックアップを上書きしない新しい prefix を使います。Firestore export に含まれる個人・認証関連データを保護できるよう、bucket の実効 IAM と継承 binding を確認し、利用者向け公開権限を付けません。条件を満たす専用 bucket がなければ No-Go です。

```sh
TASKFLOW_PROD_PROJECT='REPLACE_WITH_VERIFIED_PROJECT_ID'
TASKFLOW_DB_ID='(default)'
TASKFLOW_BACKUP_URI='gs://REPLACE_WITH_APPROVED_BUCKET/taskflow/pre-release-YYYYMMDD-HHMMSS'

gcloud firestore databases describe \
  --project="$TASKFLOW_PROD_PROJECT" \
  --database="$TASKFLOW_DB_ID"
gcloud firestore export "$TASKFLOW_BACKUP_URI/firestore" \
  --project="$TASKFLOW_PROD_PROJECT" \
  --database="$TASKFLOW_DB_ID" \
  --async
```

実行先 project、DB ID、URI を人が読み直します。返された operation 名を記録し、完了・エラーなし・文書件数/byte 数を確認します。受付成功だけでは次へ進みません。Firestore managed export は文書読み取り課金が発生します。

### 4.3 Storage の保全

実行日に確認した production bucket と専用の backup bucket/prefix を手元で照合してから、承認された recursive copy/rsync 手順を使います。同期元・先を逆にしないこと、削除同期オプションを付けないこと、既存 prefix を再利用しないことを別の人が確認します。dry-run/checksum で差分ゼロまたはコピー予定を確認し、元・先の件数・サイズ・checksum・完了時刻を記録します。

Firestore 添付文書に保存された Storage path と実ファイルの存在を代表サンプルで照合します。Storage copy が成功しても Firestore 添付参照の整合性や過去 object version を保証しません。

### 4.4 隔離先での復元リハーサル

リリース前に、別名が明らかな隔離 Firebase project の `(default)` DB へ上記 export を import し、完了を確認します。復元先 DB は本番と同じ `asia-northeast1` を基準に作成し、実行日に Firestore の対応 location 条件を確認します。production と同じ project / database ID を指定しないよう、実行前に別担当者が確認します。復元先を誤る可能性を排除できなければ実行しません。

復元 project の Firestore service agent が backup bucket と別 project にある場合は、bucket 単位でその service agent に import に必要な object read 権限だけを一時付与します。project 全体への広い Storage 権限は付与しません。対象 project の service agent principal と必要 role を Google Cloud の当日手順で照合し、復元後に一時権限を外します。source bucket の location と source database の対応、destination database の location、読み取り権限を二人で確認してから import します。

```sh
TASKFLOW_RESTORE_PROJECT='REPLACE_WITH_ISOLATED_RESTORE_PROJECT_ID'
TASKFLOW_RESTORE_DB='(default)'
gcloud firestore import "$TASKFLOW_BACKUP_URI/firestore" \
  --project="$TASKFLOW_RESTORE_PROJECT" \
  --database="$TASKFLOW_RESTORE_DB" \
  --async
```

operation 完了まで待ち、import の文書件数とエラーを記録します。バックアップ先 URI や復元先を再指定するときも、production project ID でないことを担当者2名で確認します。

最低限、既存の代表 project / member / task / subcollection / comment / checklist / activityLog / notification と、新しい可能性がある secretary、automation、autoArchive、googleWorkspace の path と型を確認します。件数・参照・Timestamp 等の型を記録します。添付 path の代表サンプルも、隔離先へコピーした Storage と照合します。

Secret Manager の実 Secret を隔離アプリへ流用せず、Google OAuth 接続を呼び出さないでください。復元試験はデータが戻ることの確認であり、隔離環境から Gmail 等へ接続する許可ではありません。

Firestore import は既存 ID の文書を上書きしますが、export にない現在の文書を削除する完全な逆同期ではありません。部分 import の cancel も既に書かれた変更を巻き戻しません。**本番 DB に全体 import して戻す手順はありません。** 広範囲障害は、別途復旧先・書き込み停止・正常更新の救出・切替方法を設計してから実施します。

## 5. 本番反映の手順

順序を変えないでください。`firebase deploy` を単独で実行して Rules、Indexes、Storage Rules 等を一括配備しません。

### 5.1 Go 判定

実行者・確認者が以下を照合し、時刻と SHA を記録してから Go にします。

- 最新稼働 Rollout / SHA / URL、最終候補 SHA、CI 結果。
- 書き込み停止が機能し、最新 Firestore export と Storage コピーが完了した。
- 隔離復元に成功し、代表文書・Storage 参照の検証を終えた。
- 本番 Rules と Indexes の現状を保存し、候補差分が説明済みである。
- viewer/role・添付の権限要件が確定し、Rules/API/Storage 試験が合格した。
- App Hosting の rollback 対象が Console に存在し、必要な Secret version と設定復旧方法も記録した。
- Google Workspace を今回有効化するか、接続不可/未接続として止めるかを明示した。
- 不在時 Job を別作業にするか明示した。今回構築しないなら Job / Scheduler / flag は無効のままにする。

### 5.2 Indexes を先に準備

本番で実際に有効な全 Index を候補 `firestore.indexes.json` と比較します。コンソールで追加された既存 Index を候補ファイルが欠いている場合は、削除・置換の影響を解決するまで No-Go です。CLI の index deploy が作成/変更/削除する範囲を、実行する CLI 版で事前確認します。

差分が承認済みで、予定外の削除がない場合に限り、専用コマンドを使用します。

```sh
firebase --version
firebase deploy --only firestore:indexes --project="$TASKFLOW_PROD_PROJECT"
```

Firestore Console/API で対象 Index がすべて `READY` になるのを待ち、追加・更新・削除内容を記録します。`BUILDING` / `ERROR` が残る場合はアプリを反映しません。

### 5.3 Firestore Rules を適用

本番に保存した旧 Ruleset と候補 `firestore.rules` の全体差分を再確認します。差分が隔離試験済みの意図した変更だけであれば、Rules だけを配備します。

```sh
firebase deploy --only firestore:rules --project="$TASKFLOW_PROD_PROJECT"
```

新 Ruleset ID と有効時刻・内容 fingerprint を取得して記録します。新しいログインセッションで、許可・拒否の代表試験を行います。Rules deploy 失敗、想定外差分、権限の広がり、既存利用の阻害を検出したらアプリを進めず、書き込み停止を維持します。

### 5.4 App Hosting を反映

App Hosting が GitHub の自動 Rollout に接続されているか、ローカルソース配備のままかを実行日に確認します。いずれか一つの配備経路だけを使い、別経路の重複 Rollout を作りません。

初回と同じローカルソース方式が現在も有効で、最終 SHA の clean worktree を配備する場合は、対象 backend を明示します。

```sh
firebase deploy --only apphosting:taskflow --project="$TASKFLOW_PROD_PROJECT"
```

GitHub 接続へ変更済みの場合は、設定された live branch と、レビュー済み SHA を指定した Rollout を使います。main への push / merge が自動配備を起こす設定なら、Rules・Indexes・backup gate 完了前に merge しません。

Cloud Build が `SUCCESS`、新 Rollout が `SUCCEEDED` となり、本番 URL のトラフィックが対象 SHA へ向いたことを Firebase Console/API で確認します。ログイン・新しい API route・DB 到達前に「配備済み」と報告しません。テスト認証は `NEXT_PUBLIC_ENABLE_TEST_AUTH=false`、`NEXT_PUBLIC_E2E_MOCK_AUTH=false` のままにします。

## 6. 配備後の確認と利用再開

最初は書き込みを伴わない確認だけを行います。

- App Hosting の URL とログイン、`/`、`/my-dashboard`、`/neo`、project board、task detail を表示する。
- 未ログイン API が401、正しいユーザーの許可 API が期待通り、別 UID・非参加者は拒否される。
- 新旧の task / comment / notification / milestone / checklist の読み込みで権限エラーを空データと表示しない。
- 個人秘書データは本人にだけ表示し、`local-bde4` を production 接続状態として読まない。
- Index/query error、permission-denied、503、未設定 Secret、OAuth callback、ログの秘密値を確認する。
- Google Calendar/Gmail/Chat は今回接続を有効にする場合のみ、合意したテストアカウントでスコープ・接続・切断・失効を確認する。Gmail/Chat の実データを手順書やログにコピーしない。
- Google 接続を今回有効にしない場合は、設定画面が未接続/準備中と明示し、API の `NOT_CONFIGURED` (503) をログイン成功や接続済みとして表示しないことを確認する。
- Cloud Run Job / Scheduler を別途構築していないなら、実行記録と画面で自動処理が稼働していないことを確かめる。

共有 DB への書き込みスモークは、事前合意した検証 project / task / user だけを使います。実施する場合、前後の値・文書ID・通知先を記録し、task/comment/review/automation/autoArchive/notification の各経路を必要なものだけ1回ずつ確認します。一般業務タスクを使わず、業務メンバーを無断で通知先に追加しません。エラー時に連打や全件再試行をしません。証拠確認前にテスト履歴を削除しません。

権限外表示、既存文書の消失・上書き、重複・部分保存、誤った task 完了/アーカイブ、OAuth 誤ユーザー接続、継続する 5xx / permission-denied / Index error、想定外の負荷を検出したら、追加書き込みを即時停止して次節へ進みます。

確認時刻を配備後15分・60分・翌営業日に記録します。Read/Write 件数、Firestore error、Cloud Run 5xx / latency、App Hosting rollout/build、Index 状態、Storage error、重複通知、自動実行状態を確認します。基準値と停止上限は作業前に決めます。

試験記録後、temporary deny Rules や保守設定を計画した通常状態へ戻し、新しいログインセッションで通常 read/write を検証します。利用者へ旧タブの再読み込みを案内します。ただし結果不明の投稿を抱えたタブは解決するまで閉じません。

## 7. ロールバックと DB 復旧を分ける

### アプリだけに問題があり DB 破損がない場合

1. 利用者・ワーカーの更新を止め、残っている自動 Rollout/実行を停止する。
2. App Hosting Rollouts から記録済みの旧 Build へ instant rollback する。旧 Build が期限切れで使えない場合は、旧 SHA で rebuild する前に当時の環境設定と Secret version を復元する。現行設定で rebuild する場合は、旧アプリとの互換性を確認して記録する。
3. 新版で保存済みのデータは残る。新しい `automation` 等の field、secretary state、Google snapshots、共有設定、履歴、通知、milestone を自動削除しない。
4. 旧アプリで読めない/書けないデータ、停止中に到着した操作、関連 Storage object を照合し、DB互換を確認するまで利用再開しない。

App Hosting の instant rollback は以前の Build のコードとその Build に紐づく環境設定を使います。一方、旧 SHA の rebuild は現在の App Hosting 設定と Secret 参照を使います。設定や Secret version を変えていた場合、旧 SHA だけを再 build しても以前の環境には戻りません。必要な設定・Secret version を先に戻すか、現行値との互換性を確認してから選びます。過去 Build の保持には期限があるため、作業日に instant rollback の可否を確認します。[App Hosting Rollout / rollback](https://firebase.google.com/docs/app-hosting/rollouts) [Build retention](https://firebase.google.com/docs/app-hosting/build)

### Rules / Indexes

- Rules を戻す操作は App Hosting rollback と別です。旧 Rules を再適用すると新しい server-only 項目や task/comment 経路が動かない可能性があるため、旧アプリ＋旧/新 Rules の組合せを試験してから選びます。保存した「配備直前の実本番 Rules」を使い、古い Git SHA を代用しません。
- 新 Index は通常、アプリ rollback だけなら残しておきます。削除が必要なら本番クエリ・現行ソースを照合し、独立した判断と手順で行います。
- 新 Rules を維持したまま旧アプリへ戻す場合も、旧クライアントの direct writes が拒否されないか確認します。判断がつかない間は書き込み停止を続けます。

### DB / Storage に誤更新・破損がある場合

1. Firestore direct writes、Admin API、Storage writes、Job/Scheduler を止める。障害時刻、影響 UID、対象 path、document IDs、Storage generation/path、operation ID を記録し、障害後の状態も別 prefix へ保全する。
2. 直前 backup を隔離 project に復元し、変更前/後と障害後に起きた正常変更を比較する。
3. 対象を限定し、`現行値 / 戻す値 / 残す正常変更 / 参照する Storage object` の修復計画を作成する。並行更新を上書きしない条件と確認担当者を決める。
4. コメント・確認依頼は comment / child task / notification / activity log をセットで照合する。自動化の戻しは履歴・根拠・タスク現在版を確認する。Storage の孤立添付は参照の有無を確認してから別途整理する。
5. 全体復元や既定 DB の入れ替えはこの手順の対象外です。新 Firestore DB へ切り替える場合、コードは `getFirestore(app)` の既定 DB を使用するため、接続先、Auth、Storage、Rules、Indexes と切替・戻しを別途設計します。

Firestore export/import は Cloud Storage 経由の復旧手段ですが、export は実行中の変更を含み得て、import は既存 ID の文書を上書きしても export にない現行文書を削除しません。障害後の通常操作として本番全体へ import しないでください。[Firestore export/import](https://firebase.google.com/docs/firestore/manage-data/export-import)

## 8. 実行記録

実行日にこの表をコピーして、秘密値を含めずに記入します。

| 記録項目 | 実行時の値 |
| --- | --- |
| 実行日時・利用停止時間 |  |
| 実行者 / 独立確認者 / 判断者 |  |
| 本番 URL / backend / Firebase project |  |
| 現行 rollout / build / source SHA |  |
| 最終 candidate SHA / CI run ID |  |
| Firestore DB ID / location / PITR |  |
| Storage bucket / location / versioning / soft delete |  |
| Firestore export URI / operation / count / bytes / 完了時刻 |  |
| Storage backup URI / count / checksums / 完了時刻 |  |
| 隔離 project / restore DB / import operation / 照合結果 |  |
| 旧 Ruleset / 新 Ruleset ID / fingerprint / 配備時刻 |  |
| Index 差分 / READY 状態 / 予定外削除の有無 |  |
| App Hosting build / rollout / SHA / 完了時刻 |  |
| OAuth namespace・Secret 名/version（値は記録しない） |  |
| Job / Scheduler の状態 |  |
| DB smoke task IDs / notification recipients |  |
| 15分 / 60分 / 翌営業日チェック |  |
| Go / No-Go / 残件 / 復旧判断 |  |

## 現在の判定（2026-09-18 再開準備後）

**No-Go**。この準備作業では本番 DB・Rules・Indexes・Storage・App Hosting に変更を加えていません。

- 最新 `upstream/main` は `95ab8e2`、ローカル `main` は `a9600b6` を基点に11コミット先行・1コミット遅れです。両者の tree 差は711 files、58,054 insertions、3,908 deletionsです。worktree にはこの手順書、`DEPLOYMENT.md`、生成 manifest、テストの未コミット変更があります。配備可能な最終 SHA とその CI 証跡はありません。
- 読み取り専用確認で Firestore `(default)` / `asia-northeast1` / PITR 無効を確認しました。project IAM には `roles/owner` と `roles/storage.admin` があり、既存バックアップ bucket には bucket-level binding がありません。ここへ新しい export を保存できる権限境界ではありません。
- Firebase App Hosting API の読み取りでは、`taskflow` の Rollout `build-2026-09-09-001` が `SUCCEEDED`、Build が `READY`、現行トラフィックが同 Build へ100%でした。既存の9/9実行記録はこの Build をローカルソース `f0613d9` と対応づけていますが、APIの今回取得結果には Git SHA が含まれず、候補 SHA の稼働証明には使えません。Firebase CLI はこの環境にありません。Secret 設定と Rules の現状は未確認です。
- Firestore composite indexes は4件すべて `READY` で候補ファイルにも存在し、候補にだけ `activityLogs` の複合 Index が1件あります。フィールド設定一覧では DB 既定設定以外の現在の override は見つからず、候補は `secretary.automationEnabled` に collection / collection-group の override を追加します。関連クエリとこの field override の差分を隔離環境で確認し、Index が `READY` になるまで新機能を有効にしません。
- Firestore / Storage の有効 Rules を調べる Firebase Rules API 読み取りは HTTP 403 で失敗しました。現行 Ruleset の ID・内容と候補 Rules との差は未確認です。権限または API 利用可否を解消するまで Rules の配備は No-Go です。
- 全利用者・Admin API・Job/Scheduler の書き込み停止確認、承認済みの別保管先、直前バックアップ、隔離復元、RPO/RTO が未解決です。
- ローカル検証は、`npm run audit` 0 vulnerabilities、生成 manifest 更新後の `npm run lint` 成功、TypeScript 成功、Node 20・クリーン依存・worker 1 で Vitest 305 files / 2,689 tests 成功です。通常の並列実行では `MeetingProposals` の1件が timeout しましたが、同ファイル単独と直列全件は成功しました。実行時刻依存の秘書更新 test は JST 09:00 に時刻固定して安定化しました。
- Production build は Google Fonts のネットワーク取得後、Turbopack が OS の process/port 制限で失敗しました。E2E smoke は未実施です。GitHub CI と本番 Rules/API/Storage 試験の合格証跡もありません。

再開には、候補を現行 upstream と整合・レビューし、正確な SHA で CI/build/E2E を通すこと、必要最小限の専用バックアップ保管先と隔離復元を用意すること、RPO/RTO を決めてから全 writer を止めることが必要です。これらが揃うまで production export/import、Rules/Indexes、App Hosting rollout は実行しません。

関連資料: [Firebase App Hosting 初回反映記録](PRODUCTION_RELEASE_EXECUTION_2026-09-09.md)、[Task automation 運用準備](TASK_AUTOMATION_OPERATIONS.md)、[AI 秘書仕様と検証記録](AI_SECRETARY.md)、[Firebase App Hosting 設定](FIREBASE_APP_HOSTING_RELEASE.md)。

公式資料: [Firestore export/import](https://firebase.google.com/docs/firestore/manage-data/export-import)、[Firestore managed backups](https://cloud.google.com/firestore/docs/backups)、[Firebase Rules test / deploy](https://firebase.google.com/docs/rules/manage-deploy)、[Firestore Indexes](https://firebase.google.com/docs/firestore/query-data/indexing)、[App Hosting environment variables / secrets](https://firebase.google.com/docs/app-hosting/configure)、[App Hosting Rollouts](https://firebase.google.com/docs/app-hosting/rollouts)。
