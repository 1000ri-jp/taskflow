# GitHub Workflow

This repository uses GitHub as the source of truth for code review, planning, and release coordination.

## Branch Model

- `main` is the canonical branch
- all changes land through pull requests
- do not push directly to `main`

Recommended branch naming:

- `feature/<short-name>`
- `fix/<short-name>`
- `chore/<short-name>`
- `docs/<short-name>`
- `codex/<short-name>` for Codex-created working branches

## Pull Request Rules

Every pull request should:

- link to an Issue
- describe the problem and scope
- include verification steps
- note any follow-up work

Preferred PR size:

- small enough for a single focused review
- ideally one concern per PR

## Label Set

Suggested baseline labels:

- `feature`
- `bug`
- `tech-debt`
- `docs`
- `api`
- `frontend`
- `backend`
- `firebase`
- `security`
- `breaking-change`
- `needs-design`
- `needs-product`
- `blocked`

Use labels for filtering and triage, not as a replacement for a clear issue description.

## Milestones

Use milestones for release or theme-based grouping.

Recommended milestone types:

- release milestone
- integration milestone
- platform hardening milestone

Examples:

- `v0.2 API hardening`
- `v0.3 GitHub workflow cleanup`
- `PAT integration GA`

## Projects Board

Recommended columns:

- `Backlog`
- `Ready`
- `In Progress`
- `Review`
- `Done`

Suggested automation rules:

- new Issues go to `Backlog`
- scoped Issues move to `Ready`
- linked PR opened moves Issue to `In Progress`
- PR in review moves Issue to `Review`
- merged PR closes Issue and moves it to `Done`

For TaskFlow board items that are synced into GitHub Issues, follow the triage rules in [`TASKFLOW_GITHUB_TRIAGE.md`](./TASKFLOW_GITHUB_TRIAGE.md) before implementation starts.
Use [`AI_DELIVERY_WORKFLOW.md`](./AI_DELIVERY_WORKFLOW.md) when the work also needs TaskFlow sync-back comments and Codex skill support.

## Branch Protection

Configure branch protection for `main` with:

- require pull request before merging
- require conversation resolution
- require status checks to pass
- restrict direct pushes
- do not allow force pushes
- do not allow branch deletion

Current CI baseline:

- `taskflow-ci`
- `taskflow-ci / audit`
- `taskflow-ci / lint`
- `taskflow-ci / test`
- `taskflow-ci / build`
- `taskflow-ci / e2e-smoke`

Single-operator default:

- no required approval
- no required code owner review
- no stale review dismissal
- no admin enforcement

`audit`, `lint`, `test`, `build`, and `e2e-smoke` should all be configured as required checks for `main`.
See [`LINT_DEBT.md`](./LINT_DEBT.md) for the current lint maintenance rules.
The audit gate runs the full dependency report and the production report through the reviewed [audit policy](./AUDIT_POLICY.md). A dated, owner-approved exception records an accepted risk; it does not remove the audit job or declare a vulnerability fixed. `npm run audit:raw` remains available for the unfiltered npm result.

Repository merge settings should be:

- squash merge enabled
- merge commits disabled
- rebase merge disabled
- delete branch on merge enabled

Production deployment:

- this repository currently has no automatic deployment Actions workflow
- provider-side Git connections and automatic rollout settings must be checked before a `main` merge; the workflow inventory alone does not establish production behavior
- deploy configuration lives in [`DEPLOYMENT.md`](./DEPLOYMENT.md); an authorized production rollout is a separate stage and does not replace the required PR checks

## Dependency Maintenance

Dependency upkeep is automated with:

- weekly Dependabot PRs for `taskflow/package.json` and GitHub Actions
- a weekly scheduled run of `taskflow-ci`
- a weekly `taskflow-maintenance` workflow that uploads a dependency health report artifact
- a manual `workflow_dispatch` trigger for ad hoc CI verification

E2E policy:

- `e2e-smoke` is the required, secrets-free Playwright gate
- it validates the login page and protected-route redirect using dummy Firebase config
- it also validates a mock-authenticated settings route using `NEXT_PUBLIC_E2E_MOCK_AUTH=true`
- broader Firebase-backed Playwright coverage stays opt-in for local verification until a stable isolated test backend exists
- see [`E2E_STRATEGY.md`](./E2E_STRATEGY.md) for the current split between required smoke and Firebase-backed local coverage

## Project Flow

Current Project v2 workflow:

- `Backlog`: issue is defined but not ready to start
- `Ready`: scope is clear and work can be picked up
- `In Progress`: code or docs changes are actively being made
- `Review`: a PR is open and waiting on review or merge
- `Done`: merged or otherwise fully completed

Manual rules:

- move new scoped issues into `Ready` only when acceptance criteria are clear
- use a closing issue reference in every PR body, such as `Closes #123`

TaskFlow-imported Issues should not move to `Ready` until they have an explicit `AI triage` comment that classifies them as:

- `already implemented`
- `partially implemented`
- `reproducible gap`
- `needs clarification`

Current automation:

- `taskflow-project-automation` adds new Issues to the configured Project v2 and sets `Backlog`
- `taskflow-project-automation` moves linked Issues to `In Progress` when a PR opens or returns to draft
- `taskflow-project-automation` moves linked Issues to `Review` when a PR is marked ready for review
- `taskflow-project-automation` moves linked Issues to `Done` on merge
- `taskflow-project-automation` moves linked Issues back to `Ready` if a PR closes without merge

Manual only:

- moving scoped work from `Backlog` to `Ready`
- triaging imported TaskFlow work before it becomes `Ready`

If the project adds more maintainers later, re-enable:

- required approval
- code owner review
- stale review dismissal

Recommended dependency PR policy:

- prefer patch and minor updates first
- keep large framework upgrades isolated
- do not batch unrelated risky upgrades into the same PR
- validate `eslint` major upgrades against `eslint-config-next` before merge; `eslint@10` is currently deferred because lint fails inside the bundled React rule stack

Current deferred dependency:

- `eslint@10.x` while `eslint-config-next` still resolves plugin versions that break at runtime under ESLint 10

See [`ESLINT10_TRACKING.md`](./ESLINT10_TRACKING.md) for the exact runtime failure and retry checklist.

## Release Discipline

Before tagging a release:

- ensure related milestone is complete or intentionally deferred
- confirm test baseline passes
- summarize API or config changes in the release notes

## Scope Boundaries

GitHub manages:

- code
- review history
- Issues
- PRs
- documentation
- release notes

Firebase remains the runtime data store for:

- projects
- tasks
- lists
- members
- notifications
