# Project task state changes API

`GET /api/projects/{projectId}/tasks/changes` adds resumable, project-scoped task state synchronization. Existing `/tasks` responses and authentication are unchanged. Use the same Bearer Firebase session or personal API token and `tasks:read` permission; token project scope and current project membership are checked on **every** request, including page retries.

## Contract

- `limit`: integer 1–200; default 100.
- `cursor`: opaque, project-bound position returned by this endpoint. Omit for initial synchronization. Do not decode, construct or modify it. It is not an authorization credential. Cursors are not signed: a structurally valid edit to an authorized project's position can be accepted and can change which records the caller synchronizes. It cannot grant project access or redirect the query to the cursor's project; the URL project and current authorization remain authoritative. Tamper-evident client state would require a separately approved signing/key lifecycle or a durable server-side position store; neither is added here.
- `tasks`: stored root task summaries (the existing list DTO plus `isArchived`, `createdAt`, `changeVersion`). Archived tasks are included. `changeVersion` is the precise document commit version, with nine fractional digits; business `updatedAt` remains unchanged.
- `nextCursor`: continuation for the same snapshot, or `null` when the round is complete.
- `checkpoint`: `null` until the final page, then the starting cursor for the **next** polling round. An empty result still has a checkpoint.
- `snapshotAt`: fixed database read time for the round, useful for diagnostics, not a client-supplied filter.

```http
GET /api/projects/PROJECT_ID/tasks/changes?limit=100
Authorization: Bearer <existing-token>
```

```json
{
  "tasks": [
    {
      "id": "task-a", "listId": "done", "title": "Draft the proposal",
      "description": "", "assigneeIds": [], "labelIds": [], "tagIds": [],
      "priority": null, "startDate": null, "dueDate": null,
      "isCompleted": true, "isArchived": false,
      "createdAt": "2026-10-02T08:00:00.000Z",
      "updatedAt": "2026-10-02T09:00:00.000Z",
      "changeVersion": "2026-10-02T09:00:00.000001000Z"
    }
  ],
  "nextCursor": "<opaque-page-position-or-null>",
  "checkpoint": null,
  "snapshotAt": "2026-10-02T09:01:00.123456000Z"
}
```

Follow `nextCursor` by URL-encoding it in `?cursor=...&limit=100`; when it is null, save the returned checkpoint and use that as the cursor at the next poll. Example algorithm:

```js
let cursor = saved.pageCursor ?? saved.checkpoint ?? null;
for (;;) {
  const url = new URL(`/api/projects/${projectId}/tasks/changes`, origin);
  url.searchParams.set('limit', '100');
  if (cursor) url.searchParams.set('cursor', cursor);
  const page = await authenticatedGet(url);
  // Durably process the page before advancing its cursor. Upsert by project/id.
  // Ignore an already processed (id, changeVersion); an archive removes the active item.
  await applyTaskSummaries(page.tasks);
  if (page.nextCursor) {
    await savePageCursor(page.nextCursor); // keep the previous completed checkpoint
    cursor = page.nextCursor;
  } else {
    await saveCompletedCheckpoint(page.checkpoint); // clear saved page cursor
    break;
  }
}
```

Do not have multiple simultaneous rounds advancing the same checkpoint. With an initial/full synchronization, reconcile missing IDs only **after the complete round**, using a per-round set/staging store. This is also the fallback for hard deletion or unstamped writers. Do not discard the previous completed checkpoint while processing pages.

## Ordering, boundaries and recovery

Initial synchronization orders all root documents by document ID, including legacy documents **without** `apiChangedAt`. It does not filter old tasks out and does not backfill or rewrite them. Later rounds query `apiChangedAt >= floorToMilliseconds(checkpoint - 60 seconds)` on the server, order by `apiChangedAt ASC, __name__ ASC`, apply `startAfter(timestamp, documentId)`, and read at most `limit + 1` documents per page. This is not a full collection read followed by client filtering.

`apiChangedAt` is a Firestore server timestamp transform written in the same commit as the task. It uses the database server clock rather than an application request/client clock. The transform is `REQUEST_TIME`, with millisecond precision; it must not be confused with the document's precise commit `updateTime` used for `changeVersion`. Every page is a read-only transaction at the first page's read time; updates that would change sort position during pagination remain visible at their old snapshot state and their new state is eligible in the next round. Document ID disambiguates commits sharing the same timestamp. The lower bound is deliberately inclusive with a **60 second overlap**, rounded down to milliseconds: boundary and recent records may repeat between rounds. Process id/version idempotently. Retries and a restarted round can also repeat records. The overlap handles timestamp rounding and short processing/visibility delays; it does **not** establish a lossless CDC guarantee for arbitrarily delayed writes. If a server transform precedes its visible commit by more than the overlap, that write could be missed until full reconciliation. Such backend timing was not verified live. For strict convergence, periodically complete a fresh full synchronization (cursor omitted) and reconcile missing IDs, or introduce a database-triggered durable change log. Source: [Firestore REQUEST_TIME precision](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/Write). Several edits between polls coalesce to the latest state at the snapshot; this is not an event log or exactly-once delivery.

Continuation pages expire after **45 minutes from the first snapshot**. `409 {"error":"CURSOR_EXPIRED"}` means abandon the page cursor and restart from the previous completed checkpoint; if bootstrap has never completed, start again without a cursor. Do not advance a checkpoint on errors. Completed checkpoints have no API expiry. `400 INVALID_CURSOR` rejects malformed or cross-project cursors; `400 INVALID_LIMIT` rejects invalid limits. Missing/invalid/expired/revoked authentication returns 401; project authorization errors remain 403/404. Authentication service failures remain server errors. Index/backend failures are errors, never an empty success or an advanced checkpoint.

The installed Admin SDK supports `runTransaction(tx => tx.get(query), {readOnly: true, readTime})`; its query serialization sends the same `RunQuery.readTime` at each page. Current backend documentation allows microsecond-precision read times within the past hour, so the API uses 45 minutes without relying on PITR. Older SDK type comments mention 60 seconds; the runtime does not impose that old limit. Sources: [ReadOnly transaction options](https://firebase.google.com/docs/firestore/reference/rest/v1/TransactionOptions), [RunQuery readTime](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.documents/runQuery).

## Scope and producer coverage

| Mutation in the updated application | Delta behavior |
| --- | --- |
| Browser task create/update, date/title/assignee/list edits, archive/restore | Root task returned |
| API task create/update, completion, list move, archive/restore | Root task returned |
| Workflow state and review cycle transitions | Stored task or stored parent returned; virtual review children are not independent stored documents |
| Recurrence completion and generated next task | Both stored root documents returned |
| Assignee batch, subtask order, checklist deadline hint on task | Changed roots returned |
| Auto archive, secretary adoption, description AI apply/undo, organization apply/undo, automation metadata/policy updates | Changed roots returned |
| Move between projects | Destination roots returned; source removal requires full reconciliation |
| Comment submission creating/changing a review request | Stored parent returned; retrieve the existing task-history endpoint for review comments/events |
| Ordinary comment add/edit/delete, checklist-only or attachment-only changes | **Not covered** unless the operation also modifies a root task |
| Hard delete of a task or project | **Not covered**; no tombstone/event log is introduced |

The response uses a summary DTO: it signals a root change, including workflow/automation-only changes, but does not embed comments, checklists, full workflow/review metadata or every task field. The existing `GET /tasks/{taskId}/history` can provide history/comments. There is currently no public GET task-detail endpoint exposing every root field; that broader contract is not added here. Never use this delta as a comment stream or complete audit history.

All root task writers found in `src` are stamped; non-task/subcollection writes are left alone. Integration metadata is excluded from existing raw-data undo/approval hashes to preserve their work-version semantics. Existing Firestore root-task rules allow this extra field; rules, authentication, and project access are unchanged. This is a trusted-producer timestamp, not a security proof: Admin SDK, external writers or a modified browser can bypass it, just as they can bypass business `updatedAt` assumptions.

**Deployment prerequisites and limits:** release the endpoint and updated browser/server writers together; old open browser versions must reload. Any external script, old deployed worker, direct SDK write, import or manual admin edit must use an equivalent server timestamp transform, or it can be missed after the checkpoint. The existing demo seeder and external scripts are not changed here. If such producers cannot be controlled, use scheduled full reconciliation until a database-triggered change log/tombstone design is implemented. No production write, migration, index, authentication change or deployment is included in this change.

The delta query uses the automatically maintained single-field ascending index for `apiChangedAt` with document ID as its final ordering; no composite index is expected. Check for deployed single-field exemptions before release; if exempted, this query requires the ascending field index. See [Firestore index defaults and final document-ID ordering](https://firebase.google.com/docs/firestore/query-data/index-overview). This patch does not change index configuration.

## Validation and release check

Local unit tests cover actual project permission/membership checks with replaced database reads, invalid Firebase token status, unsigned-position behavior, malformed ID and readTime precision rejection, pre-existing imported-ID pagination, exact rounded 60-second boundary and out-of-window full-sync recovery, old-client full-sync recovery, legacy bootstrap, bounded query shape, same timestamps, nanosecond versions, retry, exact checkpoint boundary, page writes/inserts, expiry, project isolation, current access on every request, root writer paths, and existing completion/undo behavior. A test also executes the installed real SDK with a replaced transport to inspect its `RunQuery` request.

The separate emulator suite exercises real Admin/browser SDK transport, Firestore storage, server transforms, read-only snapshots, checked-in browser rules, synthetic PAT lookup/revocation, current membership and the route handler. Only the application's database factory is replaced; it supplies the explicit dummy-project emulator database. Firebase ID-token verification against an Auth service is not part of this suite. Thirteen integration checks cover legacy/archived bootstrap without backfill, real API create/date-update/completion/archive/restore writers, identical batch timestamps, bootstrap/delta pagination with concurrent changes and retries, exact overlap and out-of-window recovery, unstamped writers/deletes/comments, project isolation, PAT scopes and membership revocation, error responses, browser marker writes and denied writes, and an actual historical page older than one minute. The initial local run also retained a snapshot about five minutes old. These are emulator results, not proof of production retention, deployed rules/indexes, latency or visibility delays.

Run with an existing Java 21+ runtime and an already downloaded official emulator JAR:

```sh
JAVA_HOME="/absolute/path/to/java21/Contents/Home" \
FIRESTORE_EMULATOR_JAR="$HOME/.cache/firebase/emulators/cloud-firestore-emulator-v1.22.0.jar" \
node scripts/run-task-changes-emulator.mjs
```

The runner starts a fresh loopback-only emulator with project `demo-taskflow-delta`, fails if the selected port is in use, rejects emulator requests for other projects, allowlists the child environment, and uses a Vitest configuration that does not load `.env` files. It installs nothing, does not change the default Java, and stops its emulator after the tests. Logs are written to ignored `test-results/task-changes-emulator/`. The aged-page test takes about a minute on a fresh emulator. Ordinary test runs skip this integration suite; the runner explicitly enables it. Override `TASK_CHANGES_EMULATOR_PORT` if 8187 is occupied.

For an optional real-time retention/expiry check, also set `TASK_CHANGES_VERIFY_LONG_CURSOR=true` on the runner command. This takes about 45 minutes: it verifies the original pending page at approximately 44 minutes 45 seconds, then checks the actual HTTP 409 route response after 45 minutes and confirms that a completed checkpoint remains usable. The clock is not mocked. This is local emulator evidence only; it does not establish Cloud Firestore production retention or deployed index/rule state.

The integrated local run passed all 14 checks, including a retained original page at age 2,685,002 ms (44 minutes 45 seconds), a 409 expired-page response at age 2,701,143 ms, and a 200 response when resuming from the completed checkpoint. The fresh emulator was stopped after verification. Application source was unchanged during the timing check.

Before enabling automation against a deployed environment, verify in an isolated test project with actual Firestore: commit-time transform values/visibility, a page approaching the 45-minute expiry, expired snapshot recovery, missing-index errors and deployed browser permissions. The native Firestore emulator does not enforce production indexes, so successful emulator queries cannot validate index availability; see [documented emulator differences](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production). The integration suite uses synthetic accounts and a local dummy database. Separately, existing Firebase CLI authorization was used for read-only production index/rule metadata: there was no `tasks`/`apiChangedAt` or `tasks`/`*` field exemption, and the active default-database rules source exactly matched the repository. No credentials were extracted or added, and no live task data, configuration or rules were written. These metadata snapshots establish current configuration, not production query behavior, retention or visibility timing. The timestamp/visibility delay assumption and deployed producer coverage remain release verification items; this endpoint is a bounded state-delta aid with full-sync recovery, not an unconditional no-loss event stream.

## Review and concrete release decisions

- Accept bounded state synchronization plus a periodic complete full-sync/reconciliation policy. Decide its interval and whether the summary DTO is sufficient for the automation. If comments, hard deletes, complete workflow fields or unconditional no-loss delivery are required, approve a different change-log/detail contract before using this endpoint for those requirements.
- The repository's normal `npm run build` passed locally through the execution environment's official approved network path. An earlier sandbox run could not resolve Google Fonts; approved HTTPS returned 200 and the unchanged build completed. Re-run required checks after integration with the separate UI worktree and in the release environment.
- In an isolated real Firestore test project, verify marker transforms, browser permissions, writes during fixed-readTime pages, pagination older than one minute but younger than 45 minutes, expired-cursor recovery, and the ascending `apiChangedAt` query. A read-only production metadata check found no task marker/wildcard exemption and matching active rules; recheck configuration at release. Actual production query/retention/visibility behavior is unverified.
- Release browser/server writer changes with the new endpoint, reload old open clients, and inventory external writers. Until producers are covered, rely on full synchronization rather than claiming complete delta coverage.
- Perform initial cursor-free full sync before starting incremental polling; store processed task versions durably before advancing a page cursor/checkpoint. Reconcile absent IDs only after all full-sync pages complete.

No composite index, Firestore rule change, auth setting, backfill migration or production data rewrite is introduced. The checked-in and read-only inspected deployed index configuration have no `tasks`/`apiChangedAt` exemption; default ascending single-field indexing is expected, with actual query verification still pending. The cached Firestore emulator v1.22.0 requires Java 21 (class version 65). With explicit user approval, the official macOS ARM64 Temurin 21 JRE archive was SHA-256 verified and extracted into the local workspace (about 46 MiB download, 151 MiB expanded). Existing Java 8 and the global default remain unchanged; `JAVA_HOME`/`PATH` are scoped to the test process. No application dependency, OS security setting or production configuration was changed.
