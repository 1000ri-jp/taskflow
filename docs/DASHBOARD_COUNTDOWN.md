# Shared dashboard countdown

`/my-dashboard` replaces the daily trivia banner with a countdown for one selected TaskFlow task. The selection is shared by eligible TaskFlow users, not stored in browser preferences. Task content and dates are never copied into the setting or changed by this feature.

## Storage and authentication

- Firestore document: `sharedSettings/dashboardCountdown` in the existing Firebase project.
- Schema: `{ target: { projectId, taskId } | null, revision: number }`.
- `GET /api/dashboard/countdown` and `PATCH /api/dashboard/countdown` require a Firebase ID token for an `@1000ri.jp` user. PAT access is not enabled.
- The API uses the existing Firebase Admin initialization. The server must have `FIREBASE_SERVICE_ACCOUNT_KEY`, or Application Default Credentials (including `GOOGLE_APPLICATION_CREDENTIALS`) authorized for this Firebase project. Do not paste credentials into chat or commit them.
- This prototype does not install credentials, deploy Firestore rules, or deploy the application. Authentication setup is deferred by the user. Without server credentials the remote picker provides an explicitly unsaved preview; shared save is disabled.
- No new direct-client Firestore rule is needed: the existing rules deny the new path, and the authenticated server handles access checks. Keep direct client access denied.

## Access and updates

The server checks project membership and task read access before returning a title, deadline, project name, or target IDs. Users without access see a restricted notice, not the private task's content. Selecting a task requires editor/admin access to its project; clearing requires write access to the current target's project. Archived projects/tasks, completed/abandoned tasks, and tasks without valid deadlines cannot be newly selected. A previously selected task may become completed or lose its deadline; the display shows that state instead of a misleading remaining-days number.

PATCH accepts only `{ target, revision }`. The revision captured when the picker opens is checked in a transaction; a concurrent update returns 409 without overwriting the other user's selection. Reopen the picker to review the current setting before retrying. There are no task, comment, notification, or user-profile writes.

Successful reads are refreshed every 30 seconds and on window focus. Errors stop interval polling; users can retry with “接続を再確認”. Dates use Asia/Tokyo for every user: future dates show “あとN日”, the deadline day “今日が期限”, and past dates “期限超過 N日”. Completed/abandoned states take precedence.

## Temporary local test mode

At the user's request, development mode on `localhost:3002` (or `127.0.0.1:3002`) uses browser storage (`taskflow.testCountdown.v1`) instead of the shared API. The UI explicitly labels this as test-only, saved in this browser, and not shared with other users. It persists only `{ target, revision }`, resolves the date and title from tasks already readable by the current user, and never modifies Firebase. No shared API request is made in this mode. Same-origin tabs observe storage changes; reload retains the selection. It is not enabled in production or on other hosts/ports. The test selection is not silently migrated into the shared Firebase setting later.

## Verification after authentication setup

Choose a real task through the UI and explicitly save. Verify the same selection in a second authorized user's session; update the target task only through the normal task workflow if needed. Check that a user without project access gets a restricted notice. Do not use real task mutations or change the shared target merely as an automated test fixture.
