# TaskFlow

TaskFlow is a Next.js application for project and task management with Firebase-backed real-time data and a server-side API layer for integrations.

## Stack

- Next.js 16
- React 19
- Firebase Authentication
- Firestore
- Firebase Storage
- Vitest
- Playwright

## Local Setup

```bash
npm install
cp .env.local.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Environment

Required client-side Firebase values are documented in [`.env.local.example`](./.env.local.example).

Server-side API routes that use Firebase Admin require one of:

- `FIREBASE_SERVICE_ACCOUNT_KEY`
- `GOOGLE_APPLICATION_CREDENTIALS`

## Source Of Truth

- Source code: GitHub
- Runtime application data: Firebase
- Review and delivery workflow: GitHub Issues + Pull Requests

Repository-wide contribution rules live in [`./CONTRIBUTING.md`](./CONTRIBUTING.md).

## Scripts

```bash
npm run dev
npm run audit
npm run deps:report
npm run build
npm run start
npm run test:run
npm run test:e2e
npm run test:e2e:smoke
npm run lint
```

## Checks

Current baseline:

- `npm run test:run` passes
- `npm run lint` passes
- `npm run audit` passes
- `npm run deps:report` generates a dependency health report
- `npm run build` passes
- GitHub Actions runs `taskflow-ci / audit`, `taskflow-ci / lint`, `taskflow-ci / test`, `taskflow-ci / build`, and `taskflow-ci / e2e-smoke`

Weekly maintenance automation also runs `taskflow-maintenance`, which uploads a dependency health report and updates a tracking issue when findings exist.
Known deferred update: `eslint@10.x` is intentionally held back until `eslint-config-next` becomes runtime-compatible.
Issue-to-PR state sync now runs through `taskflow-project-automation`, and production deploy after merge is handled by `taskflow-deploy` once the required GitHub secrets and vars are configured.

Current GitHub branch policy is tuned for single-operator maintenance:

- pull requests are required
- CI checks are required
- approval is not required
- squash merge is the default

The build script runs through `scripts/run-next-build.mjs`, which suppresses the known
`baseline-browser-mapping` false-positive warning while preserving the real build exit code and other output.

Lint should stay green on every PR. See [`docs/LINT_DEBT.md`](./docs/LINT_DEBT.md) for maintenance rules and allowed exceptions.

## API

Server routes live under `src/app/api`.

Current integration routes:

- `GET /api/projects`
- `GET /api/projects/[projectId]/lists`
- `GET /api/projects/[projectId]/status`
- `GET /api/projects/[projectId]/tasks`
- `POST /api/projects/[projectId]/tasks`
- `PATCH /api/projects/[projectId]/tasks/[taskId]`
- `DELETE /api/projects/[projectId]/tasks/[taskId]`
- `POST /api/projects/[projectId]/tasks/[taskId]/restore`
- `GET /api/auth/tokens`
- `POST /api/auth/tokens`
- `PATCH /api/auth/tokens/[tokenId]`
- `DELETE /api/auth/tokens/[tokenId]`
- `GET /api/ai/settings`
- `PATCH /api/ai/settings`

See [`docs/API.md`](./docs/API.md) for the current API surface and auth model.
See [`docs/API_INTEGRATION.md`](./docs/API_INTEGRATION.md) for curl examples and integration flow.
See [`docs/AI_ACCESS_CONTROL.md`](./docs/AI_ACCESS_CONTROL.md) for project-level AI access rules.
See [`docs/AI_DELIVERY_WORKFLOW.md`](./docs/AI_DELIVERY_WORKFLOW.md) for the TaskFlow-to-GitHub AI delivery loop.
See [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for GitHub Project status automation and production deploy setup.
See [`docs/GITHUB_WORKFLOW.md`](./docs/GITHUB_WORKFLOW.md) for GitHub workflow rules.
See [`docs/LINT_DEBT.md`](./docs/LINT_DEBT.md) for current lint status and maintenance rules.
See [`docs/ESLINT10_TRACKING.md`](./docs/ESLINT10_TRACKING.md) for the deferred ESLint 10 upgrade.

## API Auth

TaskFlow supports two auth modes for server routes:

1. Firebase ID token for first-party authenticated UI requests
2. Personal access token with `tf_` prefix for external integrations

API tokens act as a user identity. Effective access is limited by:

- token permissions
- allowed project scope on the token
- project membership
- member role (`viewer`, `editor`, `admin`)

## Testing Notes

Unit and integration tests use Vitest. End-to-end coverage uses Playwright.

- `npm run test:e2e:smoke` is the CI-safe baseline. It uses dummy Firebase config and verifies the unauthenticated login flow plus protected-route redirect without external secrets.
- `npm run test:e2e:smoke` also runs a mock-authenticated settings smoke using `NEXT_PUBLIC_E2E_MOCK_AUTH=true`.
- `npm run test:e2e` remains the broader local suite and expects a real Firebase-backed local environment, including optional `NEXT_PUBLIC_ENABLE_TEST_AUTH=true` for the existing test-user flow.

### 実 Firebase のローカル確認

会社の TaskFlow データでログインする場合は、モック用の `dev:local` / `dev:secretary` ではなく `npm run dev:real` を使います。これは `NEXT_PUBLIC_E2E_MOCK_AUTH=false` と `NEXT_PUBLIC_ENABLE_TEST_AUTH=false` を明示し、`http://localhost:3003/login` を開きます。Googleログイン後はFirestore Rulesの権限範囲内で実データを読み込みます。

Firebaseの公開クライアント設定が `.env.local` に必要です。ファイルはGit管理外で、APIキー・プロジェクトID・Authドメイン等の `NEXT_PUBLIC_FIREBASE_*` だけを置きます。サービスアカウント鍵や `FIREBASE_SERVICE_ACCOUNT_KEY` はローカルブラウザログインには不要です。

ログイン後の確認画面は `http://localhost:3003/my-dashboard` です。`dev:real` は `.next-real` を使用するため、架空データ用のビルド設定と分離できます。タスク・期限・コメントはブラウザのログイン権限で取得します。AI秘書と共通カウントダウンのAPIには、別途Firebase Adminが利用できるサーバー認証（ADC等）が必要です。APIが未接続でも「従来の一覧・予定・表示設定」から実データを確認できます。

ローカルのサーバー認証は、会社のGoogle CloudアカウントでADCを設定します。

```sh
gcloud auth application-default login --project=projectmanager-e3308 \
  --scopes=openid,https://www.googleapis.com/auth/userinfo.email,https://www.googleapis.com/auth/cloud-platform
npm run dev:real
```

Googleの認証画面ではGoogle Cloudへのアクセス許可を選択します。この方式はアカウントの既存のGoogle Cloud権限を使用し、再認証用の情報をこのMacの `~/.config/gcloud/application_default_credentials.json` に保存します。実施前にこの範囲の許可を確認してください。認証情報はリポジトリや `.env.local` にコピーしません。設定後、画面を再読み込みし、秘書欄の「取得範囲・採用履歴・再整理の設定」で取得日時・対象件数を確認できます。

参考: [Google公式のローカルADC設定](https://docs.cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)。

See [`docs/E2E_STRATEGY.md`](./docs/E2E_STRATEGY.md) for the current test-mode split.

## Project Notes

- API token management UI is under `src/app/(dashboard)/settings/api-keys/page.tsx`
- AI project access settings UI is under `src/app/(dashboard)/settings/ai/page.tsx`
- Versioned Codex skill source for this delivery loop is under `codex-skills/taskflow-github-delivery/`
- Single-function delivery agent folders live under `codex-skills/taskflow-github-delivery/agents/`
- Firebase rules and indexes are versioned in `firestore.rules`, `firestore.indexes.json`, and `storage.rules`
- Existing AI routes remain under `src/app/api/ai`
