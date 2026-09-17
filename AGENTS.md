<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## TaskFlow

Keep TaskFlow simple: reuse existing data, save paths and shared UI for the same job.

- On resuming work, verify the actual worktree, branch and dirty/untracked files. Protect existing work and browser drafts; matching HEADs do not imply matching implementations.
- The ongoing Neo/UI implementation is currently in `/Users/kozue/.codex/worktrees/bde4/taskflow`. For that work, confirm its current `AGENTS.md` and handoff before editing; do not implement against this main checkout as a substitute. Documentation work explicitly targeting this checkout may proceed here.
- Use `codex-skills/taskflow-github-delivery/SKILL.md` for TaskFlow–GitHub delivery coordination, `docs/API_INTEGRATION.md` for API integration, and `docs/FIREBASE_APP_HOSTING_RELEASE.md` for release preparation. Read only what the task needs.
- Local fixes and relevant checks may continue within the requested scope. Commit, push, PR, merge, live-data writes and production release require authorization covering that action; keep existing authorization instead of asking again.
- Verify the requested behavior and affected paths, fix failures introduced by the change, and report remaining uncertainty. Documentation-only edits need document/skill checks, not an application build or screen review.
