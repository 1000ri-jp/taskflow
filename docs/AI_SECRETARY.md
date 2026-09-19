# Neo AI秘書 — 第1段階

目的は「必要な仕事は流れ、今やらなくてよいことは安心して預けられる」。提案件数を成果にしない。

## 現行確認（2026-09-10）

- 専用 worktree は現行 main の `d46d999` を含む。着手時の差分なし。
- タスクは `projects/{projectId}/tasks/{taskId}`、コメントはその下。状態は既存の完了・中止・アーカイブ、列、依存関係を維持する。
- AI provider / API key / プロジェクト別アクセス設定 / Firebase ID token を再利用する。既存 toolExecutor の確認設定は無人実行許可にしない。
- 従来の「今日やる」は期限順、「3日動いていない」は更新日時による表示。新しい意味判断と区別する。`/` は変更しない。

## 段階

1. **今回**: TaskFlowタスク・コメントをサーバーで再取得 → LLMが根拠付きで整理 → 日付・参照・権限・競合を確定的に検証 → Neoで採用・個人保留・訂正 → 条件変化時に再評価。ローカルの架空データでも同じ判定・適用処理を通す。
2. 会議取込: 発言と引受を分け、既存タスク照合・取込履歴・出典へ戻る導線を追加。
3. Gmail / Google Chat / カレンダーの継続連携: ユーザーが接続した範囲で差分取得、水位・失敗・未接続を管理。
4. バックグラウンド実行と合意範囲内の自動更新: 再実行安全性・通知抑制・権限取消・監査を確認してから導入。

## 今回の受入条件

- 既存情報から実際に提案を生成し、候補・実行・保留・条件待ち・不要候補・完了を区別する。LLM失敗を固定ルールのAI判断で代替しない。
- 保留の理由、再検討条件、根拠のある再確認時点、未確定事項を表示。日付の根拠がなければ未設定。返信がないことや時間経過は承認・中止の根拠にしない。
- 「それで」「来週」「もういらない」「違う」で個人判断を保存。共有の完了・中止は具体的な変更を示した明示操作だけで適用。ユーザー訂正は当該タスクの範囲に留める。
- 個人判断と実タスク状態は別保存。既存Firebaseを正本とし、採用はトランザクションで二重適用・古い提案・権限漏れを拒否。取消は変更前を保持して安全に復旧する。
- 画面の前面表示中に最新情報を取得し、変化・再確認時点到来で再評価。条件解除だけで実行へ戻さない。閉じた画面で監視するとは表示しない。
- 「まずこれ1件」「判断が必要」「待っていてよい」「今日の完了線」を上部へ。期限・容量の問題は表示件数の外でも見える。時間未設定は未設定と表示。
- 未接続・失敗・部分取得・対象ゼロ、架空検証データ・実データを区別する。
- 返信到着、予定超過、検討段階の方針変更、重複、未取得、再評価、二重適用、他ユーザー漏れ、取消競合をテストする。lint・型・単体テスト・build・ローカル画面を確認する。

本番DB更新・Rulesデプロイ・Google接続/権限拡大・push・公開・外部メッセージ送信は行わない。

## 実装した往復

`/my-dashboard` 上部の「最新情報で整理」で取得→解釈→検証→保存する。自分の未完了担当タスクを整理対象とし、参加・AI許可のあるプロジェクトの既存タスクを依存・重複照合に使う。従来の一覧は下の「従来の一覧・予定・表示設定」から開く。

| 操作 | 保存・反映 |
| --- | --- |
| それで | 個人の判断を採用。確定した引受かつ着手可能なものだけ「まずこれ1件」へ |
| 来週 | 日本時間の次の月曜09:00まで個人表示で保留。共有の期限・約束は維持 |
| もういらない | 個人の実行候補から除外。共有の中止はしない。期限の警告は維持 |
| 違う | 同じ根拠の提案を繰り返さない。任意の訂正文があれば次の整理へ即時に渡す |
| 共有タスクの完了／中止も反映… | 対象と影響を表示し、本人の明示操作で既存タスクの状態を変更 |
| 採用を戻す | 個人判断を復元。共有状態も変えた場合は、その後のタスク・コメント変更がないときだけ復旧 |

再整理では返信・コメント編集、前工程の変更、タスクの変更、再確認時点の到来、具体的な訂正を検出する。待ち条件が消えても新しい提案は未採用に戻し、改めて必要性を評価する。無変更で同じ過去の再確認日時を繰り返し処理しない。

実データの自動取得は初期値1時間。設定ページの「AI秘書の取得設定」、またはNeoの「取得範囲・採用履歴・再整理の設定」から、手動のみ・1分・5分・15分・30分・1時間・3時間を選べる。このブラウザにアカウント別で保存し、同じブラウザの別タブにも反映する。共有DBへの書き込みはない。

Neoを開くと初回取得する。その後、表示中は設定間隔で取得し、画面復帰時も最後の取得開始からその間隔が過ぎている場合だけ取得する。手動更新や整理後はそこから間隔を数え直す。「手動のみ」では初回と手動操作だけ。画面を閉じると取得を停止する。この設定の対象は秘書の取得で、カウントダウンや既存のFirestore購読の頻度は別。

「この画面で情報が変わったら自動で再整理する」は画面内の設定で、初期値OFF。ONなら取得後に情報変更や再確認時点を検出した場合だけLLMを呼ぶ。取得・AI・保存の失敗時は自動再整理を止める。常駐・通知送信はない。

## データ・権限契約

- `GET /api/secretary`: Firebase ID tokenから本人を確定し、最新のタスク・コメント・個人判断を取得。`Cache-Control: no-store`。
- `POST /api/secretary`: `{provider, model?}` のみ。ユーザー指定context、userId、systemPrompt、toolsは拒否。既存providerと本人の既存APIキーを使い、サーバー固定のポリシー・tools無効で解釈する。
- `PATCH /api/secretary`: `{action, proposalId, revision, correction?}` のみ。任意のタスクpatchは受け取らない。
- 新しい個人保存先は既存Firebaseの `users/{uid}/secretary/state`。schema=1、revision、提案、個人判断、変更前後の履歴を保存。既存クライアントRulesはこの新しいサブコレクションへの直接アクセスを許可しない。Rules変更は不要。
- 保存・採用時は、AI許可設定、project.memberIds、membersのrole、タスク、コメント、個人revisionをトランザクション内で再取得。viewerは個人整理のみ。editor/adminだけ共有状態を変更できる。権限を失ったプロジェクトの保存提案は返さない。
- 提案idとrevisionで二重適用を拒否。根拠はタスク内容全体とコメントversionのハッシュ、依存先・重複照合先のversion、正確な引用で追跡。LLM応答中に入力が変わった場合も409で保存しない。
- 共有反映は既存の `isCompleted / isAbandoned / completedAt / updatedAt`、監査用の `secretaryMutationId` を更新し、activityLogsと個人履歴も同じトランザクションで記録。列移動、依存解除、新規タスク、通知・コメント送信はしない。既存Taskの読み書きと互換。
- 取消は最新の該当操作のみ。共有反映後の全タスクフィールドとコメントversionを照合するため、他の人の追記・編集を巻き戻さない。直近40操作を保持し、現在の提案から戻せるものを表示。長期監査と管理者向け復旧は次段階。

## 取得と判断の限界

- 今回は最大20プロジェクト、各300タスク、コメント取得は60タスク・各100コメント・本文8000字。上限超過・欠損日時・取得失敗は部分取得として採用を止める。欠けた履歴を「返信なし」と解釈しない。規模が大きい運用には対象プロジェクト選択と差分取得を次に追加する。
- コメントの明記日 `YYYY-MM-DD` またはタスク期限からの0〜14日前だけ再確認日に変換する。相対日付の曖昧さを推測で埋めない。期限からの逆算理由の意味はLLM提案で、人が根拠を開いて確認できる。
- 所要時間はAIの目安。未設定の時間をゼロとしない。カレンダーの空き時間や実測時間ではない。重大な期限は保留・個人不要でも上部に件数と全件一覧を残す。AI対象外プロジェクトの期限・容量は未確認と明示する。
- LLMは引用の意味を誤る可能性がある。確定処理は引用一致・参照範囲・日付・候補の実行禁止・依存条件・権限・競合を検証する。固定日数ルールによる代替回答はしない。
- Gmail、Google Chat、カレンダー、会議取込、添付本文、バックグラウンド監視は未接続。既存カレンダー表示とは別の取得範囲。

## ローカル再現

```sh
npm ci
npm run dev:secretary
# 別のターミナルで
npm run test:e2e:secretary
```

`http://localhost:3010/my-dashboard`。架空データのバナーを必ず確認する。架空データの意味応答は明示したテスト用stubで、LLM代替ではない。採用・取消・再評価・日付・競合のエンジンは実データ経路と共通。localStorageはmockユーザー別、navigator.locksでタブ間の操作も直列化。API側にはmock認証バイパスがない。

検証例: 整理→案内文を「来週」→「架空データを動かして検証」から返信到着→再整理→「それで」→完了報告→再整理→根拠を開く→共有の完了を反映→採用履歴から戻す→再読み込み。

## 検証記録

- 最終結果（2026-09-10）: `npm run test:run` 95ファイル・605テスト成功、`npm run test:e2e:secretary` 5件成功、`npm run lint`、`npx tsc --noEmit`、`npm run build`、`git diff --check` 成功。ブランチは `codex/neo-ai-secretary`、未コミット。
- 新規テスト: 意味・根拠・予定超過・返信・方針変更・候補・未取得・重複・依存先更新・訂正・二重適用・取消・ユーザー分離・viewer権限。
- Firestoreアダプターは架空のトランザクションストアで実装そのものを検証。UIだけのサンプルではなく、保存先・監査ログ・競合・共有状態の復旧を検査。
- 既存3 providerでサーバーポリシーを渡し、分割された日本語の通信チャンクを欠落させないテストを追加。
- ローカルの実画面を1280px／390px幅で目視。E2Eで保留→返信→再評価→採用→共有完了→取消→再読込、取得失敗→回復、モバイルの横はみ出しを検証。
- 初回の実装検証はモックとローカルに限定。実LLMサービスへのAPI呼出、秘書APIの実Firebaseへの読書き、実際のRulesでの統合実行は未実施。

### 実データでの表示確認（2026-09-10）

本人の指示により、以後の表示改善は `npm run dev:real` の `http://localhost:3003/my-dashboard` を使用する。通常のFirebaseログインで、本人のプロジェクト・担当タスク・期限・最新コメントが表示されることをブラウザで確認した。サンプル・未連携セクションは引き続き表示ラベルで区別する。

初回はAI秘書と共通カウントダウンのサーバーAPIが取得に失敗。ローカルのADCファイルと `.env.local` のサービスアカウント設定が未設定だった。ブラウザからの実データ表示は利用できていた。実データでのAI整理・採用・共有更新はまだ実行していない。

開発時のStrict Modeが初回取得を中断すると、次の取得が開始されず「読み込み中」に残る不具合を修正。中断したリクエストと新しいリクエストを分離し、古い応答が表示や処理中の状態を上書きしないようにした。秘書APIの取得に失敗した場合は、実タスク・コメントを確認できる従来一覧への案内を表示する。

この修正は `useSecretary` と `KozueDashboard` の28テスト、TypeScript、対象ファイルのESLint、`git diff --check` が成功。実データの画面を再読み込みし、手動更新なしで失敗状態が表示されることと、従来一覧の表示を目視確認した。

### ローカルサーバー認証の完了（2026-09-10）

本人から、会社アカウントの既存権限によるGoogle Cloudアクセスと、このMacへのADC保存について明示的な許可を受けて設定を実施。`gcloud auth application-default login` が成功し、quota projectは `projectmanager-e3308`。ADCは標準のユーザー設定ディレクトリに保存され、ファイル権限は所有者のみ読み書き可能（600）。認証情報はリポジトリに保存していない。

認証後の `/my-dashboard` で秘書のGET取得が成功し、対象8プロジェクト・67タスク（照合用を含む）・除外0件、今日までの期限8件を確認。タスク・コメント取得に関する部分取得やエラーの表示はない。ページを再読み込みしても接続が維持され、共有カウントダウンも既存設定の「生成AIなんでも展示会Vol7／期限2026-09-23／あと13日」を表示した。ブラウザの通常ログインとサーバー側のFirebase認証の両方を実画面で確認済み。

この段階は接続・読み込みの確認まで。実LLMでの整理（POST）、判断の採用・取消・共有タスクの更新（PATCH）は実行していない。次の確認対象は実データを使った提案の内容。再現手順はREADMEの「実 Firebase のローカル確認」に記載。

今後も実データの表示で確認しながらローカルを改善する。本番への反映は別の明示指示を待つ。

### 取得間隔の設定（2026-09-10）

既定の取得間隔を1分から1時間に変更。時間を進めたテストで、1時間前の取得抑止、期限到来時の取得、手動更新後の間隔リセット、設定変更、手動のみ、非表示中の停止と復帰時の取得、再マウント後の保存設定、アカウント分離を確認。関連31テスト、TypeScript、対象ファイルのESLintが成功。実データ画面で15分へ変更→再読み込み後も15分→1時間に戻す→設定ページで1時間と表示、の往復を目視確認した。

### Google Workspaceの連携候補（2026-09-10調査）

初回調査時は有効なAPI49件にCalendar・Gmail・Chat APIが含まれていなかった。その後、本人の「次はそれをやってみて」の指示でCalendar APIを有効化した（下記の接続試行記録）。Gmail・Chatは今回の対象外。

| 対象 | 現状 | 次の実装・確認 |
| --- | --- | --- |
| Googleカレンダー | Calendar API有効化済み。通常のChromeで読み取り専用接続と実予定の表示を確認済み。接続時にprimaryカレンダーを1回取得 | 更新・失敗・ページング・時刻の扱いを整え、予定を秘書の判断材料に渡す |
| Gmail | 受信箱は表示サンプル | 対象ラベル・相手などの範囲を定め、読み取りのOAuth認証と取得・スレッド照合を実装 |
| Google Chat | 未接続 | 対象スペースを定め、API設定・読み取りのOAuth認証・メッセージの差分取得を実装 |

Google CloudのADCとWorkspaceの利用者データの閲覧権限は別。継続取得にはサーバー側のOAuth認証情報管理、期限切れ・取消への対応が必要。Gmail本文の読み取りは制限付きスコープに分類されるため、会社内向け／外部公開の利用範囲に合うOAuth設定を確認する。

確認順は、まず現状の実タスクでAI提案を1回確認し、次にカレンダーの読み取り接続、その後にGmail・Chat。初期のWorkspace連携は情報取得と提案作成を対象にする。

公式資料: [Calendarの閲覧スコープ](https://developers.google.com/workspace/calendar/api/auth)、[Gmailのスコープ](https://developers.google.com/workspace/gmail/api/auth/scopes)、[Chatのメッセージ取得](https://developers.google.com/workspace/chat/list-messages)。

### 実AI・カレンダー接続の試行（2026-09-10）

- 実設定はOpenAI／`gpt-4o`。登録済みの本人のキーでモデルへの読み取りリクエストを行い、401／`invalid_api_key`を確認。キー本文やGoogle認証情報は出力・保存していない。
- OpenAIのエラーを安全な固定文へ変換し、AI秘書にも原因と次の操作を表示するよう修正。401はAI設定でのキー更新、429は利用枠不足とリクエスト上限を区別する。APIから返る生のエラー本文を表示しない。指定済みの出力上限もOpenAIの`max_completion_tokens`へ渡す。
- 実画面の「最新情報で整理」を1回実行。POSTは503となり、「OpenAIのAPIキーが無効です」「設定 → AI設定」で更新する案内を表示した。実LLMの提案生成は未完了。提案の採用・共有タスク変更は行っていない。有効なキーへの更新を本人に依頼済み。
- `projectmanager-e3308`で`calendar-json.googleapis.com`の有効化が成功。既存の`calendar.events.readonly`で接続を試したが、アプリ内ブラウザではFirebaseの`auth/network-request-failed`となり、Googleの再認証は完了しなかった。ホストから公開認証スクリプトと認証iframeへの疎通は200。予定の実データ表示は未確認。
- カレンダーの認証失敗をポップアップ制限・許可ドメイン・通信エラーに分けて案内するよう修正。許可範囲は読み取りのまま。通常のChromeでの再認証・閲覧許可が次の確認対象。

実APIの成功と提案の品質確認は、有効なキーが設定された後に続ける。カレンダーのAPI有効化と利用者の閲覧許可・実予定表示は別の完了条件として扱う。

検証: 関連5ファイル45テストのうち44件は既定時間で成功。既存の受信箱表示設定テスト1件は5秒の上限を超えたため、単独で`--testTimeout=20000`を指定して再実行し成功（実行約11秒、テスト内容・既定設定は変更なし）。TypeScript、対象ファイルのESLint、`git diff --check`も成功。実データ画面でAPIキー更新案内とGoogle認証の通信エラー案内を確認した。

### AI設定画面の連続取得を修正（2026-09-10）

「重くて開かない」の調査で、`useAISettings`の取得コールバックがZustandのストア全体を依存に含んでいたため、取得結果をストアへ保存→コールバック変更→effectが再取得、のループを確認。実サーバーのログには`/api/ai/keys`と`/api/ai/settings`のGETが合計88,615件あった。同ログに秘書のPOSTはなく、AI整理の実行による負荷ではなかった。

取得・保存コールバックの依存を安定したアクションと必要な値に限定。取得結果やモデル・プロバイダー変更による再取得の連鎖を止め、明示的な再取得は維持した。新規のhookテストは実際のZustandストアを使用し、取得成功、設定画面と相棒の複数利用、取得失敗でループしないことを確認。ストア既存テストと合わせて20件、TypeScript、対象ESLint、差分チェックが成功。

実画面で設定の読み込み完了とプロバイダー選択の開閉を確認。14:58:28〜14:59:17の49秒間、両APIの累積取得件数に増加なし。キー・プロバイダー・アクセス対象の保存操作や実AI整理は今回行っていない。

### カレンダー実接続の成功（2026-09-10）

通常のChromeにローカルの`http://localhost:3003/my-dashboard`を開き、本人の会社アカウントでFirebaseログイン後、「従来の一覧・予定・表示設定」→「Googleカレンダーを接続」を実行。既存の`calendar.events.readonly`による再認証と取得が成功し、今日の予定15件・終日予定・時刻付き予定・Googleカレンダーへのリンクを実画面とスクリーンショットで確認した。APIの有効化だけでなく、本人の予定の表示まで確認済み。

接続済みのChromeタブは閲覧用に保持。現在の接続・予定はその画面のメモリー内のみで、再読み込みや画面を離れると再接続が必要。自動更新・継続認証・秘書へのカレンダー情報提供は次段階。Gmail・Google Chatの接続、予定の変更、共有タスクの更新は今回行っていない。

### Geminiの実応答で判明した形式不一致への対応（2026-09-10）

本人が保存したGeminiキーで設定中の`gemini-3-flash-preview`のモデル情報取得が200となり、`generateContent`対応を確認。実画面のプロバイダーもGoogle (Gemini)に設定済みだった。

実データの整理では、応答受信後の再確認条件、原文引用、コメントの日付の検証で停止するケースを確認。条件が明示的にnullの場合だけ未設定の空文字列へ正規化し、欠落・別の型・長さ超過は拒否する。引用と再確認日はサーバーが元のタスク・コメントから候補を作り、AIはそのタスクに属する候補番号を選ぶ方式へ変更した。原文の言い換えや曖昧な日付の補完を採用しない。

引用は元の文字列に含まれる600文字以内の抜粋として復元する。再確認日は、既存のタスク期限から0〜14日前か、コメントに明記された有効なYYYY-MM-DDだけが候補になる。根拠番号の不明・別タスク・引用本文の直接出力は拒否し、復元後も既存の担当範囲・引用一致・全対象タスクの網羅チェックを実行する。診断時は検証項目の真偽値だけを確認し、モデルの生応答やキーをログに追加していない。調査用の一時ログは撤去済み。

検証: 根拠復元・日付・秘書の判定・APIの関連42テスト、TypeScript、対象ファイルのESLint、`git diff --check`が成功。

### Geminiでの実整理・提案表示の成功（2026-09-10 15:29 JST）

修正後の実データでGeminiの整理が成功し、担当タスク18件の提案が個人の秘書状態へ保存され、Neoの「判断が必要 18件」に表示された。先頭の「LINEコミュニティ」を開いて、状況確認の候補、取得時刻、元タスク本文の引用が表示されることを目視確認。根拠が不足する進捗は不明のまま示している。提案の採用・訂正・共有反映は実行していない。

アプリ内ブラウザーにはGeminiの提案画面、Chromeには接続済みの実カレンダー画面を保持した。両画面の表示確認が完了。次段階はカレンダーの接続維持・更新、および予定を秘書の入力に含める対応。

### 待機時の通信と初期描画の軽量化（2026-09-10）

本人の「できるだけ軽く」の指示で実行中プロセスと容量を確認。TaskFlowの開発サーバーは1組だけで、残ったVitest/Playwrightプロセスはなし。確認時のNextサーバーはCPU 0%、RSS約376MB。ログは約6.1MB、開発・ビルド用キャッシュは`.next`約354MB・使用中の`.next-real`約464MB。キャッシュ・依存ライブラリーを不要物として一括削除せず、実際に繰り返されていた処理を減らした。

- 共通カウントダウンの30秒ごとの取得を、既存の自動取得設定（既定1時間）に統一。「手動のみ」、非表示中の停止、設定変更を反映する。ヘッダーに読み取りだけの更新ボタンを追加。
- カウントダウンの日数表示は30秒ごとの再描画をやめ、日本時間の日付変更時と画面復帰時に必要な場合だけ更新する。
- 従来の一覧・会議メモ・目標の描画と受信箱コメントの取得は、初めてセクションを開くまで延期。一度開いた内容は保持し、閉じ直しによる状態消失や再マウントを避ける。
- タスクごとに全タスクを検索していた親タイトルの取得を、プロジェクトごとのID索引に変更。

検証: カウントダウンの1時間・手動・設定変更・非表示復帰・日本時間の日付変更、親タスク表示、Neo一覧の遅延表示と状態保持を含む関連43テストが成功。TypeScript、対象ESLintも成功。実画面で18件の既存AI提案、初期の一覧未描画、一覧を開いた後の実コメントを確認。15:40:06〜15:41:07の61秒間、カウントダウン・AI設定のGET件数は増加なし。AI整理のPOSTも増加なし。

## 2026-09-10 Google Workspace connection and next-month hold

- Added `来月` immediately after `来週` in proposals. It stores a personal hold until the first day of the following month at 09:00 JST. Month/year rollover is deterministic; shared deadlines/status stay unchanged. Re-review and undo use the existing personal decision history.
- `/settings/google` now manages Calendar, Gmail and Chat independently. The dashboard links to connection status, and its real Gmail/Chat rows use fetched data instead of sample messages.
- Calendar: selected maximum five calendars (default primary), today through five days ahead, at most 100 combined events. Gmail: selected maximum five labels (default INBOX), last seven days, at most 20 message metadata/snippets per label, four concurrent metadata requests. Duplicate message IDs are read once. Chat: selected maximum five spaces, last seven days, at most 20 messages each. Explicitly empty selections stop reads for that service. Attachments and Google Tasks are not read.
- Cached sources include last successful fetch, last attempt, partial/failure states. The latest cache replaces the prior snapshot; histories do not grow. Default refresh is one hour, shared with the existing per-browser refresh setting; manual-only and explicit refresh work. Hidden/background intervals pause; in-flight reads are deduplicated. Source failures preserve the previous successful data.
- Calendar cache is passed into secretary AI as dated scheduling context, with a stale flag after three hours. It cannot supply task evidence or proof of completion/cancellation. Gmail/Chat are display-only in this iteration. Calendar content/status changes invalidate stale proposals, but a timestamp-only refresh does not. No network requests run inside secretary Firestore transactions.
- OAuth uses server-side authorization-code exchange, PKCE, encrypted HttpOnly SameSite=Lax state cookie, one pending state document per user, one-time state consumption, verified exact company email/hosted domain, and actual granted-scope checks. Access/refresh tokens are encrypted with AES-256-GCM bound to user and environment. Credentials never enter client state or API responses. Token refreshes are deduplicated and protected against concurrent disconnect/reconfiguration.
- New server-owned Firestore paths: `googleWorkspaceConnections/{namespace}/users/{uid}` and `googleWorkspaceSnapshots/{namespace}/users/{uid}`. Existing client rules deny these paths. The local namespace is `local-bde4`; production must use separate config/key/namespace. No Firestore rules or shared task data were changed by implementation/testing.
- Server environment: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (32-byte hex), and `GOOGLE_WORKSPACE_NAMESPACE`. Local credentials reuse the existing Firebase Google web client and were saved only in ignored `.env.local` with mode 0600. Keep the encryption key stable. See `.env.local.example` for placeholders.

### Live verification and remaining setup

- Inspected the real signed-in Neo page: `来週` → `来月` is visibly present on proposal cards, including tooltip identifying next month 1st / 09:00 JST. Did not act on any real proposal during this implementation.
- Inspected `/settings/google`: three separate services, INBOX default, Chat unselected, refresh default one hour, and manual button render correctly.
- The initial Google connect attempt returned `400 redirect_uri_mismatch`. This is resolved: `http://localhost:3003/api/google/callback` is now registered on the existing web OAuth client, and real consent/callback flows succeeded.
- Gmail API and Chat API were enabled successfully on `projectmanager-e3308`; Calendar API was already enabled.
- Chat uses read-only user authorization. The current official configuration guide confirms that enabling the API and creating the OAuth client suffice for reading spaces/messages; no Chat bot configuration is needed for this scope.
- The Google Cloud client editor initially lacked `oauthconfig.testusers.get`. With the user's explicit approval, `roles/oauthconfig.viewer` was added for the company account on `projectmanager-e3308`. A subsequent permission test confirmed both `oauthconfig.testusers.get` and the existing `clientauthconfig.clients.update`; the client editor now loads.
- The enabled editor fields did not imply permission to save: the disabled Save button requires **all** of `clientauthconfig.clients.update`, `clientauthconfig.brands.create`, `clientauthconfig.brands.update`, `oauthconfig.verification.update`, and `oauthconfig.testusers.update`. With the user's explicit approval, `roles/oauthconfig.editor` was added temporarily, the exact local callback was saved, and its persistence was confirmed by reopening the client editor. The existing Firebase callback and origins were preserved. The temporary editor binding was then removed; a fresh IAM read confirmed no matching editor binding remains.
- Calendar, Gmail, and Chat connections were saved for the verified company account. Calendar returned 46 real events. Gmail returned the latest 20 messages from INBOX in the seven-day window and correctly shows partial coverage because more messages are available. Chat's accessible-space list returned 37 choices; message reads remain off until the user selects up to five spaces. The user was asked to choose the initial spaces.
- Verified the saved connections in both Chrome and the in-app browser, including a fresh settings tab followed by reload. Counts and last-fetch timestamps persisted without another Google consent screen. The original Neo tab was manually refreshed and now shows the real connection status. Calendar events and Gmail snippets were visually inspected. Token refresh is covered by isolated tests; a real expiry has not yet been observed.
- Real Gmail snippets exposed escaped quotes/apostrophes. The reader now decodes the five common HTML entities using existing `lodash/unescape`, once, before truncation; the UI continues rendering plain text. The existing metadata regression fixture covers escaped quotes and double-escaped text. Google reader/OAuth tests: 11 passed; TypeScript and targeted ESLint passed.
- OAuth callback requests are omitted from Next.js development access logs so the short-lived authorization code in the query string is not logged. Callback failure messages remain sanitized.
- Core secretary/calendar/security test run: 48 tests passed. Additional OAuth refresh/state/cache plus secretary hook tests: 17 passed (six source tests overlap the first run). Dashboard regressions adjusted to remove old sample-mail assumptions. Type/lint and final targeted reruns are recorded in the task response.

Primary references: [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail message list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Chat message list](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages/list), [Chat API configuration and read-only prerequisites](https://developers.google.com/workspace/chat/configure-chat-api), [OAuth config roles](https://docs.cloud.google.com/iam/docs/roles-permissions/oauthconfig).

Final verification: TypeScript, ESLint on changed implementation/test paths and `git diff --check` passed. The 24 unaffected dashboard tests passed in the full run; the two old sample-mail assertions were updated and both passed in the targeted rerun. Real browser screenshots confirmed the proposal button layout, saved connections, real calendar events, and Gmail snippets. OAuth configuration and all three service connections are complete. Chat message retrieval still awaits the user's space selection; Gmail/Chat-based AI task proposals remain outside this iteration.

### Calendar and Gmail multiple selection (2026-09-10)

- Calendar and Gmail now use checkboxes, selection counts, and a maximum of five targets each. An empty selection pauses that service. Save failures keep the user's draft open; Cancel discards the draft. Calendar choices come from the user's readable calendar list, including hidden calendars. The primary calendar is labelled `（メイン）` to distinguish it from identically named shared calendars.
- Added the read-only `calendar.calendarlist.readonly` scope. Completed the real company-account consent flow and confirmed the calendar list loads in Chrome and the in-app browser. Existing Calendar/Gmail/Chat reading grants and saved selections survive reconnection. No additional IAM role changes were needed.
- Existing documents without `selectedCalendars` keep primary. Legacy `gmailLabel` is read as a one-element `gmailLabels` array until saved/reconnected; an explicitly empty array remains empty. The browser query cache uses a new schema key so already-open pages do not consume the old response shape.
- Calendar reads use the selected IDs, retain source calendar names, namespace event IDs by calendar, sort by start time, and cap the combined result at 100. Gmail queries each selected label separately: passing multiple `labelIds` in one request would mean AND, while the required behavior is OR. Shared messages are deduplicated before metadata reads, then sorted newest first. A failed target is marked as partial; total failure preserves the previous service snapshot.
- Saving one service's selection invalidates only that service's snapshot, preserving the other sources' data and timestamps. In-flight refreshes are deduplicated by account and configuration revision so an old background request cannot block or overwrite a newly selected range.
- Verification: 35 tests across Google readers, OAuth/repository, calendar hook, and secretary integration passed. TypeScript and targeted ESLint passed. Tests cover legacy migration, explicit empty selections, calendar list access, combined calendar limits/IDs/order, Gmail union/deduplication, invalid/duplicate target rejection, cache preservation, and selection changes during an older refresh.
- Live UI: checked two calendars simultaneously, then restored and saved the original primary selection; Gmail likewise supported two simultaneous label checks, then restored and saved INBOX. Calendar save changed only its own last-fetch timestamp; Gmail and Chat timestamps were unchanged. No additional calendar or label was left selected by verification. The user had independently selected five Chat spaces before this work; they were preserved and returned 56 messages with partial coverage.

References: [Calendar list access and scopes](https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list), [Gmail label filtering semantics](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

### Gmail / Chat confirmation candidates (2026-09-10)

- The existing “最新情報で整理” action now also reviews the current selected Gmail/Chat cache. New candidates are displayed inside “判断が必要”, with source badges, exact excerpts, source timestamps/links, literal deadline expressions, uncertainties, and links to possible existing-task matches. These cards have no task-creation, send, complete, or adopt action. Existing task proposals and personal holds continue through the original engine.
- The configured AI provider/model is reused with a separate server-owned prompt and tools disabled. Gmail uses only subject/snippet; Chat uses text only. Read/unread, missing replies, or elapsed time cannot establish a commitment or completion. Routine announcements, advertisements, pure references, and already-completed work should not become new work. Matching is a suggestion, not an automatic merge.
- Inputs use at most the latest 60 cached messages per service, exact excerpt options, and accessible AI-authorized task summaries. Model output is bounded to 8 candidates and validated server-side. Quotes and Google links are restored from selected source IDs. Invented evidence, inaccessible task keys, and dates absent from the cited text fail validation. Chat links currently open the source space; quotes and timestamps identify the post. See the [Chat message resource](https://developers.google.com/workspace/chat/api/reference/rest/v1/spaces.messages) for the available source fields.
- A separate incoming signature includes selected ranges, source content/status, source freshness, authorized task versions and personal decisions. A timestamp-only refresh reuses the review. Failed/pending/disconnected/unselected or older-than-three-hour sources are excluded and labelled. A result with zero candidates is distinct from unreviewed or unavailable data; partial coverage never means all messages were checked.
- Only the latest bounded review is persisted in the existing per-user secretary state, separate from task proposals. The original task snapshot signature does not change merely because mail changed. Saving rechecks the incoming signature, task signature, revision and permissions in the transaction. A range change during generation rejects the result; stale candidates are removed from the returned view. Shared task records and Google data are not written by candidate generation.
- No additional Google calls or periodic timers were introduced. Only changed task/incoming input is interpreted; when both changed the calls run concurrently. A successful result is saved even if the other interpretation fails, with a visible warning and automatic re-review paused. Unchanged inputs reuse saved results without another AI call. Structural failure diagnostics contain only an issue code and output length, never mail, Chat content, model text or secrets.

- Live-content review exposed noisy candidates (already-acknowledged conversations, optional upgrades, unrelated recipients). The extraction prompt was tightened to use the signed-in display name, Gmail To/Cc, conversation grouping and explicit Japan-time timestamps, and to exclude routine summaries, optional offers and resolved requests. The original excerpts remain unchanged.
- Gemini sometimes exceeded the 45-second bound with default thinking. Incoming extraction opts into Gemini 3 low thinking and a 6,000-token output cap; other callers keep their previous thinking setting. The provider now honours the output cap, ignores thought text, rejects truncated output, and keeps raw error bodies out of logs. Reference: [Gemini 3 thinking controls](https://ai.google.dev/gemini-api/docs/generate-content/gemini-3).

- Message, date and task references sent to the model use short server-generated IDs; actual task keys, URLs, quotes and literal dates are restored and revalidated on save. An additional semantic verification pass checks each proposal against the original messages, recipients, chronology, task-comment excerpts and personal holds. Both passes share the 45-second deadline. Candidates containing explicit other-person-only Chat mentions, or Gmail reply proposals missing the latest available message in the conversation, are excluded before persistence.
- Final validation: 110 tests across 12 files passed, including input bounds, original-source/date/task reference restoration, duplicate handling, other-recipient and latest-reply admission, semantic-verdict completeness, scope changes during generation, cross-user isolation, partial failure preservation, unchanged-input reuse, provider truncation/privacy, UI states, and existing Google/calendar regressions. TypeScript and targeted ESLint passed.
- Live verification on the current local server: the user-selected Gmail labels (INBOX and CHAT) returned 20 messages and the four selected Chat spaces returned 57 messages, both with partial coverage. After inspecting noisy preliminary output and refining the extraction, a fresh server restart and real AI review produced one candidate: checking the fal.ai team invitation. Already-acknowledged mail and other-person requests were no longer shown. The candidate explicitly leaves acceptance status unconfirmed. Visually inspected the rendered card, expanded original excerpt, timestamp, source link, existing task decisions and hourly Google status. No proposal adoption, Google sending, task creation or shared task mutation was exercised.
- Restarted the sole port-3003 server to verify the final code after hot updates left an earlier incoming review visible. Current log: `/tmp/taskflow-real-3003-incoming.log`. Credentials and selections were preserved.

- Reload retained the single candidate and its 20:17 review timestamp. Clicking “最新情報で整理” again with unchanged data returned HTTP 200 in 778ms, retained the same review time/result, and skipped AI interpretation and state writes. The final browser is left on the candidate with its original excerpt expanded.
