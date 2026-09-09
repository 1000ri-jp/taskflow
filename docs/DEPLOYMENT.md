# Deployment

The production target is Firebase App Hosting, following the user decision on 2026-09-09. Initial cloud deployment succeeded at <https://taskflow--projectmanager-e3308.asia-east1.hosted.app>. The user confirmed successful Google login in their regular browser; see the release record for the exact validation scope.

Follow [Firebase App Hosting release steps](FIREBASE_APP_HOSTING_RELEASE.md) and the [DB release runbook](PRODUCTION_RELEASE_RUNBOOK_2026-09-07.md). Deploy Firestore milestone rules separately before the application. Neither a static export nor a bare `firebase deploy` is appropriate.

The former Vercel Actions deploy workflow has been removed. No replacement automatic deployment workflow is configured yet. The current Vercel website and its independent Git integration have not been changed.

## Production Path

1. Complete audit, lint, tests, build, E2E, and the DB checks.
2. Confirm the Firebase backend, runtime identity, public web config, and authorized login domains.
3. Deploy the reviewed Firestore rules and verify the active ruleset.
4. Run `firebase deploy --only apphosting:taskflow --project=projectmanager-e3308`.
5. Verify the Cloud Build, rollout, generated URL, login, API, and existing data before directing users to the new site.

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
