# TaskFlow 本番反映手順書（2026-09-09更新）

**配信先変更（2026-09-09）：ユーザー指示によりFirebase App Hostingへ変更。[Firebase用の追加手順](FIREBASE_APP_HOSTING_RELEASE.md)が本書のVercel配備工程に優先する。DB保全・検証の注意点は継続する。**

初版：2026-09-07。既存リンク維持のためファイル名は変更しない。

## 1. 結論・今回の範囲

**既存DBの一括移行は行わず、バックアップと権限検証を済ませ、マイルストーン用Firestoreルールを配備してからアプリを反映する。DBの復元はアプリのロールバックと分ける。**

本書は手順の作成であり、本番反映・DB接続・バックアップ・通知送信は実施していない。

調査対象は `/Users/kozue/taskflow` の main ワークツリーのみ。他のWTは参照していない。

| 項目 | 調査時点の確認結果 |
| --- | --- |
| main HEAD | `a91da99283b1ed7b28a5cf1d1885300009a4177b` |
| ローカルに保存された比較元 | `upstream/main` = `af3b7c0`。fetchしていないため最新リモート／本番版とは未確定 |
| 差分 | 比較元から6コミット、184ファイル。前回調査 `8c56793` から4コミット、26ファイル追加変更 |
| 更新開始時 | 前回作成の本書は未追跡、`docs/DEPLOYMENT.md` は変更済み。どちらも保持して更新。実装ファイルの未コミット変更なし |
| Firebase CLI既定値 | `.firebaserc` は `projectmanager-e3308`。実際の本番接続先は未確認 |
| DB構成 | Firestore + Firebase Storage。SQLマイグレーションは対象差分にない |
| ルール・インデックス | `firestore.rules` に `projects/{projectId}/milestones/{milestoneId}` のread/write許可を追加。Storageルール・インデックス・firebase.jsonは変更なし |
| 配信 | バージョン管理上は GitHub Actions → Vercel。実環境の設定は未確認 |

**本番稼働SHAを確定し、そのSHAとmainの差分が本書の前提と一致するまで実行しない。** 比較元が異なる場合はDB差分も再点検する。以下の空欄・未確認は実行時の担当者が埋める。

### 今回の更新対象コミット

- `ab16ba2`：カレンダーの日付ドラッグ更新。
- `478bc2a`：ダッシュボードのコメントにプロジェクトアイコン表示。
- `9e04fac`：ダッシュボード各所にプロジェクト色・アイコン表示。
- `a91da99`：マイルストーンの共有CRUD・タスク紐付け、カレンダーからタスク追加、ブリーフの自分／全員切替など。

前回の「ルール配備なし」は撤回する。アプリのCI／Vercel配備ワークフローにFirebaseルール配備は追加されていないため、§7の別工程が必要。

## 2. 実行記録と開始条件

| 記録項目 | 実行時に記入 |
| --- | --- |
| 実行者／確認者／障害時の判断者 | 未記入 |
| 作業日時・利用停止時間帯・復旧に使える時間 | 未記入 |
| 本番URL／Vercelチーム・Project ID | 未記入 |
| 現在の本番Deployment ID・URL・Git SHA | 未記入 |
| 今回反映する最終Git SHA | 未記入（手順書を含む最終コミットを記録） |
| Firebase Project ID／DB ID／DBロケーション | 未記入。コードは `getFirestore(app)` による既定DBを使用 |
| Storageバケット／バックアップバケット | 未記入 |
| 現行Firestore・Storageルールの保存先／インデックス一覧 | 未記入 |
| 新旧Firestore Ruleset ID・内容ハッシュ／配備時刻 | 未記入。一時停止用ルールと通常運用用ルールを区別 |
| Vercel環境変数・IAM構成の保全先 | 未記入。秘密値は本書やGitへ保存しない |
| Firestore export URI／operation名／完了時刻 | 未記入 |
| Storage復旧手段／復元リハーサル結果 | 未記入 |
| 検証専用プロジェクト・タスク／参加するテスト担当者 | 未記入 |
| Go / No-Go／判断時刻 | 未記入 |

開始条件：本番版特定、復旧可能なバックアップ、隔離環境でのDB検証、最終SHAのCI成功、旧Deploymentへの復帰手段の確認がすべて完了していること。失敗時の復旧時間が作業枠を超える場合も延期する。

## 3. 影響範囲（保存先と操作を区別）

| 変更 | 書き込み先・タイミング | 注意点 |
| --- | --- | --- |
| コメント投稿・共有確認依頼 | 投稿操作でコメント、子タスク、通知、活動ログを1トランザクションで保存 | 通常コメントも新しい投稿経路になる。マイ画面だけの変更ではない |
| 共有カウントダウン | 選択保存／解除時に `sharedSettings/dashboardCountdown` | 新しい共有ドキュメント。Admin SDK経由。未作成のまま読み取り可能、事前作成不要 |
| チェックリスト並べ替え | `projects/{p}/tasks/{t}/checklists/{c}` の `items` 配列をtransaction更新 | 順序は共有。本文・完了・IDが維持されることを確認 |
| マイルストーン管理 | `projects/{p}/milestones/{m}` に作成・更新・物理削除 | タスクの `milestoneId` は別更新。削除で紐付けを自動解除しない |
| カレンダーの日付ドラッグ | 対象タスクの日付4項目と、依存先タスクの日付を更新 | 複数ドキュメントに波及。全体transactionではない |
| カレンダーから追加 | クリック日の期限を持つタスクを既存リストに作成、活動ログも記録 | リストの開始日自動設定・自動完了設定も適用 |
| ブリーフの自分／全員切替 | `taskflow.brief-display` にブラウザ保存 | 全員は参照可能な参加プロジェクト内。会社全体への権限拡張ではない |
| プロジェクトの色・アイコン | ダッシュボードは既存項目を表示。設定画面の保存は共有プロジェクト更新 | 設定変更と表示を分けて検証 |
| 詳細画面のアーカイブ操作 | 既存タスクのアーカイブ機能を呼ぶ | 表示から消える。削除と区別して試験する |
| ボード・テーブル・カレンダー・計画リスト | 表示切替・ソート設定はブラウザ保存。既存の編集操作は共有DBへ書く | 表示だけの設定と実編集を混同しない |
| マイ画面・コメント一覧 | 参加プロジェクトのタスク／タスク別コメントを読む | タスク数に応じた読取増加・遅延・一部失敗を監視 |
| 目標・Meetリンク・朝会下書き・チェックリスト担当等 | localStorage | 本番ドメインへ自動移行されない。ユーザー別に分離されない設定もある |
| 自動アーカイブ設定 | ブラウザで対象候補を表示 | 今回は自動アーカイブ処理・定期ジョブではない |
| 相棒AI | 既存のユーザー会話パスを維持、Firebase初期化を遅延化 | 会話一覧・保存と既存AI操作を回帰確認 |
| Google Calendar／表示サンプル | Calendarの接続状態とサンプル表示を区別 | Gmail・スコア等は未連携。朝会の固定メモも本番配信物に含まれるため公開範囲を確認 |

### 3.1 コメント・確認依頼の具体的なDB差分

- 子タスク：`projects/{projectId}/tasks/{childId}` に `parentTaskId`, `sourceCommentId`, `taskKind: 'review_request'` を追加。既存の担当・期限・完了フィールドを利用。
- コメント：`projects/{projectId}/tasks/{taskId}/comments/{commentId}` に任意の `reviewTaskId`。
- 通知：`notifications/{commentId}:{userId}`。新種別 `review_requested`、通常投稿は `comment_added`。同一受信者の重複はまとめる。
- 受領記録：`projects/{projectId}/activityLogs/comment-{commentId}`。同じ投稿IDの再試行を識別する。
- 添付ファイルは先にStorageへアップロードする。Firestore transactionの外なので、DB保存失敗時に孤立ファイルが残り得る。

既存全タスクに新フィールドを埋める処理は不要。過去コメントの再投稿、既存チェックリスト担当の共有化、朝会候補の一括登録も行わない。受領記録は再試行による重複防止に必要なため、失敗調査中に削除しない。

### 3.2 マイルストーンと日付操作のDB差分

**マイルストーン**

- 新サブコレクション：`projects/{projectId}/milestones/{milestoneId}`。保存項目は `projectId`, `title`, `description`, `status`, `dueDate`, `order`, `achievedAt`, `createdBy`, `createdAt`, `updatedAt`。statusは `planned / in_progress / achieved / cancelled`。
- タスク側には任意の `milestoneId: string | null`。既存タスクへの一括付与は不要。画面の選択操作で1タスクずつ設定／解除する。
- 進捗は関連タスクから計算し、マイルストーンへ自動書き戻ししない。完了タスク数とマイルストーンの手動ステータスは独立。
- 一覧は `order` 昇順クエリ。新規作成時には必ずorderを保存する。既存の手作成ドキュメントにorderがない場合、読取側の既定値ではクエリから除外される問題を救えない。該当データの有無を確認する。
- 削除は確認ダイアログ後の `deleteDoc` であり、アーカイブ／復元UIはない。紐付いたtasksの `milestoneId` は残る。業務利用では削除前に紐付けを解除して再読込・確認する。アーカイブ済みタスクも棚卸し対象にする。
- CRUD・タスク紐付けは別々の書き込みで、revisionによる競合検知や一括transactionはない。同時編集・削除と紐付けの競合は実環境相当で検証する。
- 既存のプロジェクト削除関数にもサブコレクションの連鎖削除はない。マイルストーンの片付けを目的にプロジェクト削除を使わない。

**カレンダー**

- ドラッグは `startDate`, `dueDate`, `durationDays`, `isDueDateFixed` を再計算して共有保存する。期限を明示変更すると固定期限になる。開始日の変更も、固定期限・期間の設定に応じて期限または期間を変える。
- `useBoard.editTask` から依存先の日付更新が再帰的に走る。対象の保存と依存先の保存は一括transactionではなく、依存先の失敗はconsoleに記録される。対象だけ保存成功でも全体成功と判断しない。
- 既存Undoは対象タスクの値だけを戻し、依存先の日付まで戻さない。ドラッグ前後の対象・依存先IDと日付4項目を記録し、復旧時は全体を照合する。
- 日付逆転を拒否する明示的検証はこの経路に見当たらず、期間が0以下になる入力を試験する。保存失敗の画面通知、連打による重複作成防止もこの画面では未整備。§5の合格条件を満たさない場合は修正後に再検証し、手順書だけで安全扱いしない。
- 日付クリックでの追加は、その日を期限にして既存 `addTask` を利用。選択リストの自動開始日・自動完了を引き継ぐ。作成時の `durationDays` はnull、`isDueDateFixed` はfalseで、ドラッグで期限を設定する場合と異なる。
- 日付はブラウザのローカル日付・時刻で生成される。JST前提で日跨ぎを確認し、別タイムゾーンを利用するなら同じ期限がどう見えるかも検証する。

### 3.3 権限に関するリリース前の必須判断

現行ファイルのFirestoreルールは、許可ドメインかつプロジェクト参加者ならタスク・コメント・チェックリスト・活動ログ・新規マイルストーンの書き込みを許可し、viewer/editorを区別していない。通知のcreateも許可ドメイン単位である。**viewerの書き込みをDBで拒否する運用を期待している場合、現状のままではその保証がない。要件を確定し、必要な修正と権限試験が終わるまでNo-Go。** 今回のマイルストーン用ルールも `canAccessProject(projectId)` のみで、スキーマ・ロール・アーカイブ状態・紐付け先の存在を検証しない。この要件判断と予定されたパス追加を分け、場当たり的なルール緩和はしない。

共有カウントダウンAPIは別の判定を使う。

- Firebase ID tokenと `@1000ri.jp` を要求。PATには対応しない。
- `memberIds` にUIDが存在し、`members` サブコレクションに同じ `userId` と正しい `role` が必要。
- 読取はviewer/editor/admin、保存はeditor/admin。解除は現在選択中のプロジェクトへの書き込み権限を要求。
- クライアントから `sharedSettings/dashboardCountdown` への直接アクセスは拒否のままにする。
- Admin SDKはFirestoreルールとは別に動くため、API認可の試験も必須。

片方にしかないメンバー情報があると「ボードは見えるがカウントダウンは403」になり得る。不一致を一覧化し、DBの一括補完で解消しない。対象・正しい所属・ロールを確認して別途修正する。

## 4. 事前準備（main WT内で確認）

```sh
cd /Users/kozue/taskflow
git branch --show-current
git status --short --branch
git rev-parse HEAD
git log --oneline upstream/main..HEAD
```

1. mainであること、反映対象に意図しない変更がないことを確認。作業者が実行時にリモートを更新・確認し、本番稼働SHAとの比較をやり直す。別WTの内容は混ぜない。
2. Vercelの現行本番DeploymentとそのSHAを記録。旧Deploymentを削除しない。
3. GitHubの `production` Environmentの承認設定、およびVercel Git連携による独立した自動デプロイの有無を確認。バックアップ前にmainを更新して自動配信を発火させない。
4. 本番クライアント設定のProject ID、Storage bucket、Admin資格情報の対象を照合する。`.firebaserc`だけで対象を決めない。`.env.local`を本番へ丸ごとコピーしない。
5. `FIREBASE_SERVICE_ACCOUNT_KEY` または利用可能なADCを本番サーバー側で確認。ローカルファイルパスをVercelへ設定しただけではADCは使えない。秘密値はログへ出さない。
6. 本番で `NEXT_PUBLIC_E2E_MOCK_AUTH` / `NEXT_PUBLIC_ENABLE_TEST_AUTH` を有効にしない。PreviewのFirebase接続先も隔離先か確認する。Preview URLだけではDBは隔離されない。
7. 実際に配備中のFirestore／Storageルールとインデックスを取得・保全し、mainのファイルと比較する。差分が承認済みのマイルストーン用match追加だけであることを確認する。他の本番独自差分があれば上書きせず停止。今回はFirestoreルールだけを配備し、Storageルール・インデックスは配備しない。
8. `npm run seed:demo` は実行しない。予定外のルール緩和、DB初期化、全件置換、裸の `firebase deploy` は今回の通常手順に含めない。

## 5. 反映前の検証

最終リリースSHAでCIの `audit / lint / test / build / e2e-smoke` をすべて通す。手動再現は以下。mainの依存環境を再構築する時間を確保して実行する。

```sh
npm ci
npm run audit
npm run lint
npm run test:run
npx tsc --noEmit --pretty false
npm run build
npx playwright install chromium
npm run test:e2e:smoke
```

本書作成時にはこれらを再実行していない。既存手引きの過去の成功記録は今回の最終SHAの合格証明にしない。モックテスト成功だけでもDB互換性の証明にはならない。

### DB検証の合格表

隔離Firebaseプロジェクトまたはルールエミュレータに、現行本番ルールと必要な最小データを準備し、追加予定のルールへ更新した前後を試験する。旧ルールではmilestonesを拒否、新ルールでは承認した参加者のみ許可することを確認する。現状の `firebase.json` にはエミュレータ設定・専用ルール試験手順がないため、準備と検証結果を別途残す。本番の業務タスクで障害注入試験を行わない。

| 試験 | 合格条件 |
| --- | --- |
| 新フィールドのない旧タスク／旧コメント | 表示・編集・完了が維持される |
| 通常コメント（通知先なし） | コメントと受領記録のみ作成、子タスク・通知は増えない |
| 複数担当の確認依頼 | コメント1・子タスク1・受領記録1、通知は宛先ごと1。親の期限・完了は変わらない |
| 同じ投稿IDの再試行 | 件数が増えず、既読通知・完了済み子タスクを巻き戻さない |
| transaction失敗・通信結果不明 | DBに一部だけ保存されない。結果不明時は同じタブ・IDで確認／再試行できる |
| 添付の失敗 | DB投稿なし。孤立ファイルのパスを記録できる |
| 非参加者・別ドメイン・未ログイン | 参照・投稿の拒否。参加者viewerは3.3で確定した期待結果と照合 |
| memberIdsとmembersの不一致 | 原因を特定できる403になり、他プロジェクトの情報は漏れない |
| カウントダウン初回GET | ドキュメント未作成で未設定表示。勝手に書き込まない |
| カウントダウン保存・解除 | 対象ドキュメントのみ更新、revisionが1増える。タスク・通知不変 |
| カウントダウン同時更新 | 同じrevisionで後から保存した操作は409。選択し直せる |
| カウントダウン権限外／完了・期限なし等 | 権限外データ非表示、不正対象の新規選択拒否 |
| チェックリスト並べ替え | ID・本文・完了状態を維持。別端末の追加／完了変更と同時実行して欠落しない |
| 新版で作成したデータを旧版で読む | 旧版のボード・タスク・通知がクラッシュしない。専用表示の欠落は記録 |
| マイルストーン初期表示／CRUD | 0件・ロード中・権限エラーを区別。作成・編集・達成／解除の日時、別セッションの反映を確認 |
| マイルストーン権限 | 未ログイン・別ドメイン・非参加者を拒否。viewer／アーカイブ済みプロジェクトは§3.3の確定要件と照合 |
| タスク紐付け／解除／削除 | 他項目不変。削除前の解除と再読込で残存参照なし。既に削除済みの参照を未設定と誤認しない |
| マイルストーン同時操作 | 編集同士、削除と紐付けの競合を確認し、許容できない上書き・参照切れは解消してからGo |
| カレンダードラッグ | 開始／期限／同日両方、固定期限／期間優先、月週切替、日跨ぎを検証。日付4項目が期待通り |
| 日付逆転・依存先・失敗 | 不正な期間が保存されない。依存先全体の更新を確認。通信・権限失敗で成功と誤認しない。部分成功を検出・修復できる |
| カレンダーUndo | 対象のみ戻る現状を記録し、依存先も含む復旧を検証 |
| 日付クリックで新規作成 | 追加先・期限・開始日自動設定・自動完了を確認。二重送信／結果不明の再試行で重複作成しない |
| 自分／全員・色・アイコン | 参加範囲外は表示しない。自分／全員の再読込、画像・絵文字・色・欠損時表示を確認 |
| 読取負荷 | 大きいプロジェクトで時間・読取件数を記録し、合意した許容値以内 |

旧版は新規データを理解する専用UIを持たないため、「任意フィールドの追加だから戻せる」と推定しない。特に `review_requested` の通知表示、子タスク編集後の追加フィールド保持を確認する。マイルストーンは旧版に専用画面がないため、旧版でのタスク更新後も `milestoneId` を保持するか確認する。

## 6. DBバックアップと復元リハーサル

### 6.1 バックアップ対象

- Firestoreはサブコレクションを含めた全体export。`projects` だけのcollection指定では関連データ全体の保全にならない。
- Storageオブジェクトは別途保全。バケットの世代管理／soft deleteの設定・保持期間と、実際に既存ファイルを復元できるか確認する。無効なら書き込み停止中に別の保護バケットへコピーして検証する。
- Firestore／Storageルール、インデックス、IAM、Auth設定、Vercel設定は別途記録する。Firestore exportだけではこれらは復元できない。
- 新規milestonesとtasksのmilestoneIdも、存在する場合はバックアップと復元照合の対象に含める。
- 新しい `taskflow.brief-display` は現行ブラウザバックアップの許可リストに含まれていない。必要なら自分／全員の選択を別途記録する。
- ブラウザ設定は本番オリジンの利用者ごとのデータ。必要ならブラウザバックアップ画面で出力する。DBバックアップとは別物で、未確定投稿のsessionStorageの代わりにもならない。

export/importには課金の有効化、適切なIAM、利用可能なCloud Storageバケットが必要。準備が不十分なら開始しない。[Firestore公式手順](https://firebase.google.com/docs/firestore/manage-data/export-import)

### 6.2 整合した時点を確保する

1. 作業枠に入り、利用者に投稿・編集を止めてもらう。結果不明の投稿は先に同じタブで確認する。
2. 外部連携・API/PAT・AIによる更新、Admin SDKを使う処理、別の開いたタブを含め書き込み経路を停止する。**Vercelを止めるだけでは開いた画面のFirestore直接書き込みを止められない。**
3. 厳密な書き込み停止が必要なら、現行ルールを保全した上で担当者が検証済みの一時書き込み拒否ルールを適用し、Admin経路も停止する。これは別の保守操作として対象と復旧手順を記録する。ルールだけではAdmin更新は止まらない。
4. 書き込み停止を検証できなければexportを完全な同一時点バックアップと扱わない。本手順では停止して整合性を確保する方式を原則とし、できなければNo-Go。

Firestoreの通常exportは開始時点の厳密なスナップショットではない。整合した移行には書き込み停止が必要と公式にも説明されている。[公式の移行手順](https://firebase.google.com/docs/firestore/manage-data/move-data)

### 6.3 exportコマンド例（実行時に対象を確定）

以下は担当者が値を確認して実行する例。本書作成では実行していない。バックアップはアクセス制限された保管先に置き、Gitへ追加しない。

```sh
TASKFLOW_PROD_PROJECT='REPLACE_WITH_VERIFIED_PROJECT_ID'
TASKFLOW_DB_ID='(default)'
TASKFLOW_BACKUP_URI='gs://REPLACE_WITH_BACKUP_BUCKET/taskflow/pre-release-YYYYMMDD-HHMMSS'
gcloud firestore databases describe --project="$TASKFLOW_PROD_PROJECT" --database="$TASKFLOW_DB_ID"
gcloud firestore export "$TASKFLOW_BACKUP_URI" --project="$TASKFLOW_PROD_PROJECT" --database="$TASKFLOW_DB_ID" --async
```

返されたoperation名を記録し、完了とエラーなしを確認する。受付成功だけで先へ進まない。

```sh
TASKFLOW_EXPORT_OPERATION='REPLACE_WITH_RETURNED_OPERATION_NAME'
gcloud firestore operations describe "$TASKFLOW_EXPORT_OPERATION" --project="$TASKFLOW_PROD_PROJECT"
```

出力に記録された実際のexport URIとmetadataの存在、完了時刻、処理件数を確認する。Storage保全の完了も待つ。

### 6.4 隔離先で復元を確認する

事前に隔離先のIAM・バケットアクセス・インデックスを準備する。可能なら作業日前にリハーサルし、当日は最新バックアップの完了を再確認する。

```sh
TASKFLOW_RESTORE_PROJECT='REPLACE_WITH_ISOLATED_RESTORE_PROJECT_ID'
TASKFLOW_RESTORE_DB='(default)'
gcloud firestore import "$TASKFLOW_BACKUP_URI" --project="$TASKFLOW_RESTORE_PROJECT" --database="$TASKFLOW_RESTORE_DB" --async
```

**復元先が本番と違うことを確認してから実行する。** 操作の完了を確認し、代表プロジェクト、tasks、comments、checklists、members、notifications、activityLogs、存在する場合はmilestones・tasksのmilestoneId・sharedSettingsを照合する。日時型・参照ID・添付実体との対応も確認。復元時間と結果を記録し、復元できないバックアップでリリースしない。

## 7. 本番適用（順序を固定）

1. §2〜6の完了を確認しGo判定。停止中にDBのseed・backfill・共有設定・マイルストーンの事前作成を行わない。反映対象SHAを固定し、ルールもそのSHAの内容を使う。
2. **アプリより先にFirestoreルールを配備する。** バックアップ完了・承認済み権限試験の後に、下記の限定コマンドで配備する。配備前後のRuleset ID・時刻・内容を記録し、本番の有効なルールがmainの予定した内容になったことを確認する。
3. 一時書き込み拒否ルールを使っていた場合、この配備は通常の書き込み許可を再開する操作にもなる。旧版画面を含め利用停止を継続し、この時間の書き込みを管理できないなら§2の段階で保守方式を見直す。一時ルールを後から戻してマイルストーン許可を消さない。
4. 承認済みの最終コードをPR経由でリモートmainへ反映する。ローカルmainがaheadでも、無条件の直接pushで保護ルールを迂回しない。実際のリモートとの差と承認フローを確認する。
5. mainへのpushで動いた `taskflow-ci` が成功したことを確認。その `head_sha` を使う `taskflow-deploy` のproductionジョブを確認する。
6. ワークフローはVercel本番設定取得 → 本番build → `deploy --prebuilt --prod` を実行する。**このジョブはFirebaseルールを配備しない。** §7-2の成功を別に確認する。
7. `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` 不足時は成功扱いで配備をスキップし得る。**Actionsの緑色だけで反映完了としない。** 新Deployment ID・SHAと本番ドメインの切替を確認する。
8. Admin連携・一般利用はまだ停止し、テスト担当者だけで§8のスモークを行う。合格後に一般利用と外部連携を再開。利用者には旧タブを再読み込みしてもらう。ただし結果不明の投稿を抱えたタブは解決前に閉じない。

Firestoreルール配備の実行例（本書更新時には未実行）：

```sh
cd /Users/kozue/taskflow
# §6で確認した本番Project IDを再確認し、使用するCLIの版も記録する
firebase --version
firebase deploy --only firestore:rules --project="$TASKFLOW_PROD_PROJECT"
```

本番IDが空／仮値なら実行しない。使用CLIは事前に隔離環境で確認した版を使う。`firebase.json` が想定通り既定DB1つの設定であることを再確認する。コマンド成功だけでなく有効Rulesetを確認し、反映を待って新しいセッションで許可／拒否を試験する。これはルール全体を配備するため、本番独自ルールの取りこぼしがないことが前提。[Firebase公式ルール配備手順](https://firebase.google.com/docs/rules/manage-deploy)

ルール配備失敗ならアプリを進めない。ルールのみ成功・アプリ失敗なら利用停止を継続し、旧アプリ＋新ルールを維持するか、保全した旧ルールへ戻すかを§9で判断する。

このmainには新機能全体を本番で段階開放する共通フラグがない。限定ユーザーだけへの切替を前提にしない。段階配信が必要なら、その制御の準備を別途完了させる。

## 8. 配備直後の確認・監視

まず読取だけで、ログイン、既存トップ `/`、`/my-dashboard`、ボード各表示、タスク詳細、マイルストーン一覧、通知、AI会話一覧を確認する。DB権限エラーを「0件」と表示しないこと、カウントダウンAPIの503がないことを確認。

次に、事前合意した検証用タスクとテスト担当者だけで以下を1回ずつ行う。これは共有DBへの書き込み／通知を伴う。業務メンバーを無断で通知先にしない。

- 通知先なしの通常コメント、合意済み受信者への確認依頼。別セッションで子タスク・通知・元コメントへの移動を確認。
- チェックリストの並べ替え。項目数・本文・完了が変わらないことを確認。
- カウントダウンの明示保存。事前値を記録し、検証後は最新revisionを使うUI操作で元の選択へ戻す。数値を過去のrevisionへ書き戻さない。
- 専用タスクのアーカイブと既存の復元操作。通常タスクに対して実行しない。
- マイルストーンを1件作成・編集し、専用タスクの紐付け／解除を確認。削除試験は解除後の検証用マイルストーンだけで行い、事前値とIDを記録する。
- カレンダーで専用タスクの日付変更と、日付指定の新規作成。依存先を含む事前・事後値を確認し、戻す際も全対象を照合する。失敗注入は本番で繰り返さない。
- 自分／全員の切替・再読込、色・アイコンの表示確認。設定画面を試す場合は検証用プロジェクトだけにする。

作成したドキュメントIDとStorageパスを記録。証拠確認前にテストデータ・受領記録を掃除しない。

開始後15分・60分・翌営業日に担当者が確認し記録する（自動監視は本書では設定しない）。Vercel APIの401/403/409/503、Firestore permission-denied／インデックスエラー、読取量・書込量、表示速度、重複通知を確認する。負荷の基準値と許容上限は作業前に記録する。

即時停止条件：権限外情報の表示、既存データの消失・意図しない更新、コメント等の部分保存・重複、主要画面の利用不能、継続する503、許容上限を超える負荷。利用を止めて§9へ進む。

## 9. ロールバック・DB復旧

### A. アプリ不具合のみ（DB破損がない）

1. 利用者の更新を止め、自動再配備・実行待ちdeployを止める。Git連携など別の配信経路も確認する。
2. 記録済みの旧DeploymentへVercel管理画面でInstant Rollbackする。本番ドメインと旧SHAを確認。
3. 旧版で既存タスク・通知を確認。新規の子タスク・コメント・通知・共有設定・マイルストーンとtasksのmilestoneIdはDBに残す。追加フィールドを削除しない。日付変更は旧版へ戻しても残る。
4. DBとの互換性が確認できたら利用再開。リモートmainの修正／revertは別PRで行い、再デプロイ時のSHAを確認する。

アプリのロールバックはDBと外部状態を巻き戻さない。環境変数も現在の設定との差を確認する。[Vercel公式ロールバック手順](https://vercel.com/docs/instant-rollback)

### A-2. Firestoreルールを戻す場合

アプリのロールバックとは別工程。旧ルールへ戻すと新しいマイルストーンへのクライアントアクセスが拒否されるが、ドキュメントは消えない。

1. ルール追加が問題なら新旧アプリ・直接クライアント・Adminの書き込みを止め、旧アプリへの切替も行う。新版のままルールだけ戻して運用を再開しない。
2. 保存済みの「配備前に実際に有効だったルール」を確認し、Firebase Consoleのルールエディタで内容を照合して再公開する。Gitの比較元が本番と同一とは限らないため、単に `af3b7c0` のファイルを配備しない。
3. 有効Ruleset IDを記録し、旧機能の権限とmilestonesへの拒否を新しいセッションで確認する。取り残された新版タブには再読込を案内する。
4. アプリだけの不具合で承認済み新ルールを維持する場合はその判断を記録する。旧版に画面がなくても追加パスのアクセス許可は残る。

### B. 限定した誤更新がある

1. クライアントとAdmin双方の書き込みを止める。発生時刻、ユーザー、投稿ID、対象ドキュメント、添付パスを記録し、障害発生後の状態も保全する。
2. バックアップを隔離先へ復元し、本番の対象と比較する。リリース後の正常な変更を区別する。
3. 修復対象ごとに「現在値・戻す値・残す正常変更」を用意し、判断者が確認する。更新時刻等の事前条件を用いた限定修復で、並行更新の上書きを防ぐ。
4. コメント・子タスク・通知・受領記録はセットで照合する。受領記録だけを消すと再投稿で重複し得る。Storageの孤立ファイルは参照がないことを確認して別途整理する。
5. カウントダウンだけの問題なら、権限と最新revisionを確認した通常APIで修正する。不正スキーマでAPI自体が使えない場合は、現状保全後にその1ドキュメントの修復計画を作る。

6. 日付ドラッグの誤更新は対象と依存先の全タスクについて日付4項目と更新時刻を照合する。Undoだけで完了にしない。期間・固定期限フラグも戻す対象を決める。
7. マイルストーンを誤削除した場合は隔離復元から同じIDの内容を確認し、残存するtasksのmilestoneIdと照合して限定復元する。別IDで作り直すだけでは関連は復旧しない。誤紐付けは変更されたタスクのみ修復する。

### C. 広範囲な破損がある

全面復旧は別の復旧作業として判断する。本番へそのままexportをimportすることを通常の戻し方にしない。

Firestore importは同一IDを上書きする一方、exportに存在しない現在のドキュメントを自動削除しない。したがって、新版で作った子タスクや通知を残しつつ、正常な既存更新だけを古く戻す危険がある。[Firestore importの仕様](https://firebase.google.com/docs/firestore/manage-data/export-import)

障害後の保全 → 隔離復元 → 失われる正常更新と残存する新規データの棚卸し → 復旧先・修復対象・停止時間の確定 → 承認 → 復旧 → 件数／リンク／権限確認の順に進む。新DBへの切替を選ぶ場合、現行コードは既定DBを使うため、接続先・認証・Storage・インデックスを含めた別計画が必要。

## 10. 完了条件・参照した実装

完了条件は、最終SHAの本番配信確認、既存業務画面と合意済み共有操作の成功、DB不整合なし、予定したFirestoreルールの有効化確認、書き込み停止設定の復旧、監視記録、バックアップ保管先と復旧担当者の確定。ブラウザ限定下書き・未接続機能を「共有化済み」としない。

実装根拠（すべてmain WT）：

- `.github/workflows/taskflow-ci.yml` / `taskflow-deploy.yml`、`docs/DEPLOYMENT.md`
- `src/lib/firebase/commentSubmission.ts`、`src/lib/task/commentSubmission.ts`、`src/components/task/CommentComposer.tsx`
- `src/lib/firebase/admin-countdown.ts`、`src/app/api/dashboard/countdown/route.ts`、`src/lib/auth/projectAccess.ts`
- `src/lib/firebase/checklist-order.ts`、`src/lib/firebase/firestore.ts`、`src/types/index.ts`
- `src/app/(dashboard)/projects/[projectId]/milestones/page.tsx`、`src/lib/milestones.ts`、`src/components/board/TaskCalendarView.tsx`、`src/hooks/useBoard.ts`
- `src/stores/briefDisplayStore.ts`、`src/lib/dashboard/brief.ts`、`src/components/dashboard/ProjectIconBadge.tsx`
- `firestore.rules`、`storage.rules`、`firestore.indexes.json`、`firebase.json`、`.firebaserc`
- `docs/SHARED_COMMENT_REVIEW_REQUESTS.md`、`docs/DASHBOARD_COUNTDOWN.md`、`docs/DASHBOARD_MEETING_PROPOSALS.md`

本書の確認範囲はソース差分と配備・復旧手順の整理。本番設定の実査、実DBでの権限試験、バックアップ取得、復元リハーサル、リリース判定は未実施。
