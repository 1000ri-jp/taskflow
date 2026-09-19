# AI Delivery Workflow

TaskFlow holds the runtime backlog. GitHub holds issues, code review, merge history and delivery state. This contract applies to linked delivery requests; ordinary local edits do not require an Issue, external comments or a pipeline.

## Scope and stages

Perform the stages covered by the request. Existing authorization persists; skill selection or a successful review does not grant permission for additional external actions. Prepare a concrete result before seeking any missing authorization for posting, pushing, merging or release.

- **TaskFlow intake:** follow [TASKFLOW_GITHUB_TRIAGE.md](TASKFLOW_GITHUB_TRIAGE.md), inspect current behavior, classify the request and preserve source project/task IDs and board URL. When Issue coordination is authorized, record the `AI triage:` decision before implementation.
- **Implementation and review:** implement the scoped gap and use [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md) for branch, PR and merge requirements. Select local checks by affected behavior; retain all required CI gates before merge.
- **Merge and release:** execute only the authorized action. Report merge and deployment separately; confirm the actual deployment result before claiming publication. Release preparation uses [FIREBASE_APP_HOSTING_RELEASE.md](FIREBASE_APP_HOSTING_RELEASE.md).

## TaskFlow sync-back

For a requested delivery loop with TaskFlow feedback, post `[AIからのメッセージ]` at triage completion, meaningful scope changes, PR opening and final merge/closure without code. Include Issue number, PR number or `なし`, status and a short Japanese result. A narrower local or review request does not trigger comments.

Use confirmed source IDs and destination. If feedback is required but cannot be posted, report it as pending; do not claim the loop is closed. Preserve the distinction between implementation, review, merge, deployment and feedback.

## Skill and helpers

Versioned source: [`codex-skills/taskflow-github-delivery`](../codex-skills/taskflow-github-delivery/SKILL.md). Paths resolve from the actual checkout. This repository contract takes precedence over a stale installed copy; compare any installed copy before using it.

The skill links to posting and optional staged-runner instructions. The stage folders and `agents/pipeline.yaml` are optional automation resources, not required steps for every edit. Keep this contract current when the workflow changes; avoid repeating it in each entrypoint.
