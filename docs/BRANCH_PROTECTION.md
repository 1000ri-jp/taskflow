# Branch Protection Checklist

Apply these settings to `main` in GitHub repository settings.

## Required

- require a pull request before merging
- require conversation resolution before merge
- require status checks before merge
- block direct pushes
- disable force pushes
- disable branch deletion

## Status Checks

Current required checks:

- `taskflow-ci / audit`
- `taskflow-ci / lint`
- `taskflow-ci / test`
- `taskflow-ci / build`
- `taskflow-ci / e2e-smoke`

Keep `strict` status checks enabled so the branch must be up to date before merge.

## Single-Operator Default

For the current single-operator workflow, keep these review gates off:

- require approvals
- require code owner review
- dismiss stale approvals
- include administrators

This keeps `main` protected by CI without deadlocking merges for a solo maintainer.

## Repository Merge Settings

Recommended repository-level merge settings:

- enable squash merge
- disable merge commits
- disable rebase merge
- delete head branch on merge

## Deploy Behavior

No deployment Actions workflow is currently configured. Provider-side Git connections and automatic rollout settings must be verified separately before merging. Keep `taskflow-ci` as the required merge gate; follow [the deployment workflow](DEPLOYMENT.md) for a separately authorized production rollout.

## When To Tighten Rules

If the repository moves beyond single-operator maintenance, turn these back on:

- require at least one approval
- require code owner review
- dismiss stale approvals
- consider including administrators
