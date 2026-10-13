# E2E Strategy

## Goal

Keep one fast, deterministic Playwright gate in CI while leaving room for broader Firebase-backed end-to-end coverage locally.

## Test Modes

### Required CI smoke

`npm run test:e2e:smoke`

This runs two browser passes:

- unauthenticated smoke:
  verifies `/login` and protected-route redirect behavior
- authenticated smoke:
  enables `NEXT_PUBLIC_E2E_MOCK_AUTH=true` and verifies a logged-in settings path without external Firebase state

The smoke runner injects dummy Firebase config and disables the existing Firebase test-auth flow, so it does not require secrets or a shared backend.

## Mock Auth Mode

Mock auth mode is only intended for localhost Playwright smoke coverage.

Behavior:

- `AuthProvider` injects a deterministic mock user
- Firestore initialization is skipped
- project and notification subscriptions short-circuit to empty state

This is intentionally narrow. It exists to prove authenticated layout and routing behavior, not to simulate full Firebase functionality.

## Isolated PDF preview regression

`npx playwright test --config playwright.pdf.config.ts`

This suite starts its own mock-only server on `127.0.0.1:3020` with dummy Firebase values and fictitious task/comment attachments. It intercepts the exact Firebase Storage fixture URL and blocks all other external requests and API calls. It covers loading, native PDF rendering, download-only responses, HTTP/network failures, timeout/retry, close/reopen and Blob URL cleanup on desktop and narrow screens. The general Firebase-backed suite excludes this spec; use its dedicated config.

Use Node 22, matching CI, and a full Chromium browser (`channel: chromium`) because the older headless shell may lack the native PDF viewer. To use an already installed binary, set `PDF_PREVIEW_CHROMIUM_PATH` to its executable path.

The fixture confirms rendering with the application's actual CSP. It does not verify a production Storage object's CORS, access, or PDF structure; files with a PDF signature but damaged internals remain the native viewer's responsibility.

## Firebase-backed local suite

`npm run test:e2e`

The broader Playwright suite still targets a real local Firebase-backed environment and may use:

- `NEXT_PUBLIC_ENABLE_TEST_AUTH=true`
- real Firebase client config in `.env.local`
- a shared or seeded backend state

Use it for flows like:

- project creation
- board interaction
- task editing
- calendar and gantt behavior

## Local Full-Suite Caveats (2026-07-07 時点)

素の `npm run test:e2e`（実 Firebase 環境）でフルスイートを回すときの既知の注意点:

- **テストユーザーは Firestore 権限がない**: `test-login` のユーザーではプロジェクトの購読・作成が
  `Missing or insufficient permissions` で失敗する。`createProject` ヘルパーに依存するテスト
  （calendar.spec など）はこの環境では失敗し、project.spec は自動スキップする。
  プロジェクトデータが必要なテストは **デモログイン（`data-testid="demo-login"`、シード済み
  プロジェクトあり）** を使うこと（例: `e2e/ai-tool-confirm.spec.ts`）。
- **スモーク3本（auth-smoke / authenticated-smoke / demo-login）は素の実行では失敗する設計**:
  これらは `npm run test:e2e:smoke`（`scripts/run-playwright-smoke.mjs`）が注入する
  ダミー Firebase 設定・環境フラグが前提。フルスイートでの失敗は想定内で、判定はスモークランナー側で行う。
- **開発ビルドの React Query Devtools ボタンが右下の相棒AIトグルに重なる**: クリックが
  intercept されるので、テスト側で `.tsqd-parent-container { display: none !important; }` を注入する。
- **AI チャットのテスト**: `/api/ai/chat`（SSE）と `/api/ai/settings` を `page.route` でモックし、
  `ai-settings-storage` の localStorage を `addInitScript` で注入すればプロバイダ設定済み状態を再現できる。

## Expansion Plan

Near-term target:

- keep the required smoke suite fast and secrets-free
- add one isolated authenticated happy path at a time

Longer-term target:

- move Firebase-dependent E2E coverage onto emulators or seeded disposable data
- stop relying on shared manual backend state for core user flows

## Acceptance Bar For New Required E2E Coverage

Only promote a Playwright flow into required CI when all of these are true:

- no shared mutable backend state is required
- no manual secrets are required beyond the existing repo baseline
- the flow is deterministic under single-worker CI execution
- failures produce useful artifacts and are easy to reproduce locally
