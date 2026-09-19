# Delivery helpers

Repository paths below are relative to the verified checkout. The canonical [delivery contract](../../../docs/AI_DELIVERY_WORKFLOW.md) defines milestones; [GitHub workflow](../../../docs/GITHUB_WORKFLOW.md) defines merge checks. Do not duplicate those checklists here.

## TaskFlow sync-back

Use `scripts/post_taskflow_ai_message.py --help` for arguments. Supply confirmed `projectId`, `taskId` and `--base-url`; the script's legacy production default is not a reliable destination. Keep the PAT in `TASKFLOW_PAT` and use the minimum scope described in [API integration](../../../docs/API_INTEGRATION.md).

Preview with `--dry-run` before an authorized post. The helper formats `[AIからのメッセージ]`, Issue, PR, status and Japanese details; use actual results and `なし` for absent artifacts. If a post times out or its outcome is uncertain, check for an existing comment before retrying.

## Optional staged runner

Only use `scripts/run_delivery_agents.py` when the user requests staged agent execution. Its default sequence is `issue-to-code` → `pr-review` → `merge-deploy`; a generic implementation or review request does not authorize that full sequence.

- Read `agents/pipeline.yaml` for stage inputs/outputs and use `--help` for runner options.
- Bound execution with `--from-stage` and `--stop-after-stage` to authorized stages; preview with `--dry-run`. Use `--prompt-suffix` to carry the actual scope and permissions. Do not enable `--unsafe` for ordinary delivery.
- Keep the default bounded attempts. Check persisted stage state and remote results before resuming after a failure, avoiding duplicate PRs, comments or merges.
- Stage prompts provide the requested operation, not authorization beyond the user's request. Required CI checks and authorized merge/release scope still apply.

The runner parses `OK:` / `NG:`, `PR:`, `Verification:`, `Review:` and deployment results. Preserve these machine-readable contracts if changing runner prompts. Dry-run previews do not verify delivery or deployment.
