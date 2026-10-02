# API

## Authentication

TaskFlow server routes accept:

- Firebase ID tokens via `Authorization: Bearer <firebase-id-token>`
- personal access tokens via `Authorization: Bearer tf_...`

Personal access tokens are evaluated as a user identity, then constrained by:

- token permissions
- token project scope
- project membership
- project role

## Token Management

### `GET /api/auth/tokens`

Returns API tokens for the current authenticated user.

### `POST /api/auth/tokens`

Creates a new API token.

Request body:

```json
{
  "name": "Claude Desktop",
  "actorDisplayName": "Codex",
  "actorIcon": "🤖",
  "permissions": ["projects:read", "tasks:read", "tasks:write"],
  "projectIds": null,
  "expiresAt": null
}
```

`name` is the management label for the token itself.
`actorDisplayName` and `actorIcon` are optional audit-facing metadata used when TaskFlow shows actions performed via that token.

### `PATCH /api/auth/tokens/[tokenId]`

Deactivates a token.

### `DELETE /api/auth/tokens/[tokenId]`

Deletes a token.

## First-Party AI Settings Routes

These routes are intended for the authenticated TaskFlow UI, not external PAT integrations.

### `GET /api/ai/settings`

Returns AI project access settings for the current user.

Response shape:

```json
{
  "allowedProjectIds": null
}
```

`null` means the user's AI can access all current and future projects.

### `PATCH /api/ai/settings`

Updates AI project access settings for the current user.

Request body:

```json
{
  "allowedProjectIds": ["project-a", "project-b"]
}
```

## Project Routes

### `GET /api/projects`

Returns projects visible to the authenticated user, filtered by token scope if present.

### `GET /api/projects/[projectId]/lists`

Requires project read access.

Returns ordered project lists including:

- `id`
- `name`
- `color`
- `order`
- `autoCompleteOnEnter`
- `autoUncompleteOnExit`

### `GET /api/projects/[projectId]/status`

Requires project read access.

Returns:

- project metadata
- task summary counts
- per-list counts

### `GET /api/projects/[projectId]/tasks`

Requires `tasks:read`.

Returns non-archived tasks in the project.

### `POST /api/projects/[projectId]/tasks`

Requires `tasks:write` and non-viewer project membership.

Supports:

- title
- description
- listId
- assigneeIds
- labelIds
- tagIds
- dependsOnTaskIds
- priority
- startDate
- dueDate
- durationDays
- isDueDateFixed

### `PATCH /api/projects/[projectId]/tasks/[taskId]`

Requires `tasks:write` and non-viewer project membership.

Supports partial update of:

- listId
- title
- description
- assigneeIds
- labelIds
- tagIds
- dependsOnTaskIds
- priority
- startDate
- dueDate
- durationDays
- isDueDateFixed
- isCompleted

### `POST /api/projects/[projectId]/tasks/[taskId]/comments`

Requires `tasks:write` and non-viewer project membership.

Supports:

- content
- mentions

If the request is authenticated with a personal access token, TaskFlow may also persist audit-facing author metadata such as:

- `authorLabel` like `Naofumi via Codex`
- `authorIcon` like `🤖`

Notes:

- comment author is always the authenticated user
- attachments are not yet supported through the public API

### `DELETE /api/projects/[projectId]/tasks/[taskId]`

Archives the task. This is a soft delete.

### `POST /api/projects/[projectId]/tasks/[taskId]/restore`

Restores an archived task.

## Error Model

Current routes use standard HTTP status codes:

- `400` invalid request body or invalid field values
- `401` missing or invalid auth
- `403` permission denied
- `404` missing project or task
- `409` invalid state transition such as restoring a non-archived task

## Notes

- List and task APIs intentionally expose application-oriented JSON, not raw Firestore documents.
- API routes currently focus on project and task integration use cases.
- Lint cleanup is still tracked separately from API feature work.

See [`API_INTEGRATION.md`](./API_INTEGRATION.md) for concrete curl examples and a recommended client flow.

## タスク差分取得

`GET /api/projects/{projectId}/tasks/changes?limit=100&cursor=<opaque-cursor>` は初回同期後の追加・更新をプロジェクト単位で返します。既存の `tasks:read` とプロジェクト権限が必要です。保存した `checkpoint` で次の差分取得を開始し、`nextCursor` を最後まで辿ります。アーカイブを含み、通常コメント単独・物理削除は対象外です。契約、ページ期限、更新元の前提は [TASK_CHANGES_API.md](./TASK_CHANGES_API.md) を参照してください。
