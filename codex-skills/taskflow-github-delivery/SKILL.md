---
name: taskflow-github-delivery
description: Coordinate TaskFlow tasks with GitHub issues, PR review and delivery status. Use for that linked workflow, not ordinary TaskFlow code or UI edits.
---

# TaskFlow GitHub Delivery

TaskFlow holds the runtime backlog; GitHub holds issue, review and delivery history. Work from the verified checkout and remote, not a machine-specific path.

Use only the requested stage. Reading this skill does not authorize posting, pushing, merging or deploying. Continue authorized local preparation and verification; existing authorization need not be repeated. A successful review is not permission to merge or proof of deployment.

- For TaskFlow-to-Issue triage, use [the triage rules](../../docs/TASKFLOW_GITHUB_TRIAGE.md). Inspect existing behavior before classifying or mirroring a request; preserve the source project/task IDs and board URL.
- For implementation or PR review, use [the GitHub workflow](../../docs/GITHUB_WORKFLOW.md) where relevant. During development select checks for the affected behavior; before merge retain the required CI gates. Do not rerun every gate after a documentation or isolated local edit without a reason.
- For delivery milestones and completion, use [the delivery contract](../../docs/AI_DELIVERY_WORKFLOW.md). API authentication/scopes are in [API integration](../../docs/API_INTEGRATION.md), needed only for API work.
- For posting a sync-back message or explicitly requested staged automation, read [helper usage](references/workflow.md). The runner and its stage folders are optional; routine edits do not require a multi-agent pipeline.

Complete the requested stage, recording verification and any remaining blocker. Distinguish local implementation, review, merge, deployment and TaskFlow sync-back; do not claim a later stage completed without evidence.
