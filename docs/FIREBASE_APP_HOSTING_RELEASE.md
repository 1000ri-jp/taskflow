# Firebase App Hostingへの配信先変更

2026-09-09のユーザー指示により、今回の配信先をVercelからFirebase App Hostingに変更する。Next.jsのAPIルート・Admin SDK・AI処理を維持するため、静的HostingではなくApp Hostingを使う。現時点では設定準備のみで、バックエンド作成・公開は未完了。

本書は従来の本番反映手順書のVercel配備工程を置き換える。バックアップ、権限検証、既存データ互換性、DB復旧の注意点は継続する。ユーザーは稼働中バックアップの取得結果を了承して続行を指示済み。隔離復元は未検証であり、検証済みと記録しない。

## 配備設定

- プロジェクト：`projectmanager-e3308`。Firestore・Storage・Authを継続利用する。
- バックエンド予定ID：`taskflow`。未作成。
- `firebase.json` にApp Hostingのローカルソース配備を追加。`.env*`・鍵ファイル・ローカル生成物等を除外。
- `apphosting.yaml` はFirebase APIから取得した既存Web Appの公開設定を使用。秘密鍵は含めない。
- テスト認証フラグは両方false。Admin SDKは実行サービスアカウントのADCを利用する。
- 起動数0〜2、CPU 1、メモリ1GiB。上限は費用の絶対的な保証ではない。負荷検証後に調整する。
- 旧Vercel自動配備ワークフローは削除し、今後のmain更新によるActionsからのVercel配備を止める。Vercel側のGit連携と現行サイトは未変更。

## 再開・公開手順

1. App Hosting APIの有効化。2026-09-09の実行は `serviceusage.services.enable` 不足で403。管理者へ有効化を依頼済み。
2. CLI認証を準備し、実際に利用可能なリージョン・バックエンド一覧を確認して作成する。最終リージョンと生成URLを記録する。
3. 実行サービスアカウントのFirestore/認証用権限と、配備者の `iam.serviceAccounts.actAs` を確認する。利用者のAIキーは既存Firestore保存経路を継続する。
4. Cloud Build上の実際のNode.js/Next.js対応とビルド成功を確認する。必要なAPIやビルド権限の不足を解消する。
5. ローカルのaudit/lint/test/build/e2e成功後、予定どおりのFirestoreルールだけを配備する。現行ルールはバックアップ済みで、差分はmilestonesのmatch追加のみ。
6. `firebase deploy --only apphosting:taskflow --project=projectmanager-e3308` で配備し、Cloud Build・rolloutの完了、公開URLを確認する。裸の `firebase deploy` は使わない。
7. 新しいホスト名をFirebase Authの承認済みドメインに設定し、Googleログイン・API・既存タスク・添付・通知を検証する。Google CalendarのOAuth設定も必要な場合に合わせる。
8. 新URLでは旧ドメインのlocalStorage・ログイン状態が自動移行しない。ブラウザ下書きの必要な保全・移行を確認する。独自ドメイン/DNSの切替は既存URLを確認してから行う。
9. 初回App Hosting配備には旧App Hosting rolloutがないため、不具合時は新URLの利用を止めて従来サイトへ戻す。既存Vercelサイトは復旧確認まで削除しない。DBはアプリの切替では戻らない。

## 検証状況

依存関係の監査修正後：`npm run audit` は0件、lint成功、build成功、90ファイル561テスト成功。ビルドと並行した初回テストでは14件がタイムアウトしたため、ビルド完了後に全件を単独再実行して成功した。タイムアウト閾値は変更していない。通常のnpm ci監査ではoptionalを含むmoderate 8件が残る。必須auditはoptional除外である。

E2Eスモークも成功（認証3件・デモ2件・モック認証済み画面1件）。初回は更新後のChromiumが未導入で失敗したため、インストール後に再実行。デモの無効なプレースホルダーキーによる認証エラーは試験の想定内。GitHub CIと本番スモークの成功証拠はまだない。

公式資料：[ローカルソースの配備](https://firebase.google.com/docs/app-hosting/alt-deploy)、[設定と実行環境](https://firebase.google.com/docs/app-hosting/configure)。
