# Deployment

The production target is Firebase App Hosting, following the user decision on 2026-09-09. Initial cloud deployment succeeded at <https://taskflow--projectmanager-e3308.asia-east1.hosted.app>. The user confirmed successful Google login in their regular browser; see the release record for the exact validation scope.

Follow [Firebase App Hosting release steps](FIREBASE_APP_HOSTING_RELEASE.md) and the [current production release runbook](PRODUCTION_RELEASE_RUNBOOK_2026-09-18.md). The [2026-09-07 DB runbook](PRODUCTION_RELEASE_RUNBOOK_2026-09-07.md) documents an older milestone-focused candidate and must not be used by itself for the current Rules/Indexes changes. Neither a static export nor a bare `firebase deploy` is appropriate.

This section is only a summary. Follow the detailed runbook's No-Go gates, database restore rehearsal, and deployment order before production changes.

The former Vercel Actions deploy workflow has been removed. No replacement automatic deployment workflow is configured yet. The current Vercel website and its independent Git integration have not been changed.

## Production Path

1. Complete audit, lint, tests, build, E2E, and isolated DB/Rules/Indexes checks.
2. Confirm the Firebase backend, runtime identity, public web config, authorized login domains, current live SHA, and delivery mode.
3. Pause and verify every writer, create a fresh Firestore export and Storage copy, then prove Firestore restore in an isolated project.
4. Deploy reviewed Firestore indexes and wait for `READY`; then deploy reviewed Firestore rules and verify the active ruleset.
5. Run the explicit App Hosting backend rollout command for the verified delivery mode.
6. Verify Cloud Build, rollout, URL, login, APIs, permissions, and existing data before directing users to the site.

Use `apphosting.yaml` for runtime configuration. Keep credentials and local `.env` files out of source uploads. The server uses its Google Cloud runtime identity for Firebase Admin access.

## GitHub Project Configuration

Issue automation still uses the `PROJECTV2_TOKEN` secret, `GH_PROJECTV2_NUMBER` variable, and optional `GH_PROJECTV2_OWNER` variable. Missing values cause that automation to skip its updates.

## GitHub Project Automation

`taskflow-project-automation` keeps linked Issues aligned with the delivery flow.

Automatic transitions:

- Issue `opened` or `reopened` -> `Backlog`
- PR `opened`, `reopened`, or `converted_to_draft` -> linked Issue `In Progress`
- PR `ready_for_review` -> linked Issue `Review`
- PR `closed` with merge -> linked Issue `Done`
- PR `closed` without merge -> linked Issue `Ready`

Linked Issues are detected from the PR body.
Use a closing reference such as `Closes #123` in every PR.

## Repository Settings

Keep these repository settings aligned with the automation:

- require pull requests for `main`
- require the `taskflow-ci` checks to pass before merge
- enable squash merge
- delete branch on merge

Production deployment requires the reviewed revision and successful validation.
