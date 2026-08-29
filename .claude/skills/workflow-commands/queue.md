# `queue` — Sequential multi-issue fullrun

Each issue in the queue is a full `fullrun`, so read `fullrun.md`, `chain-rule.md` and
`followup.md` as well; this file only adds what running several of them back to back changes.


`queue #N1 #N2 #N3 ...` runs `fullrun` for each issue in order. All issues must already exist (no `new` variant).

**The target repository is named in front of each Issue reference** — `queue kit#1 kit#2`. The definition is the same at every entry point: `SKILL.md` → "2c. The `owner/repo#` prefix" (canonical: `prompts/collaboration-workflow/target-repo.md`). **One queue runs against one repository**: every reference must resolve to the same target, because step 1 below runs `josh latest` once for the whole queue and a mixed queue would run it in only one of them. Split a mixed batch into one queue per repository. The checkout rule is the one every implementing entry follows — resolve it from `pnpm josh doctor`, and stop and report rather than cloning. Step 1's `git stash` covers this session's own tree, and a prefix naming this repository changes nothing; a *different* repository's checkout that is not clean stops the run instead, since that work is not yours to stash. A target whose owner is not this session's is third-party: Tier C, so it stops rather than filing.

**Steps:**

1. If the working tree already has staged or modified files, stash them first: `git stash`. Run `git switch main && git pull`, then `josh latest` once (before the first issue) — **mandatory, never skip**. Verify the overrides are unchanged in both `pnpm-workspace.yaml` and `package.json` and `devEngines` changed only by the expected `josh latest` pnpm bump, by loading the `dependency-update` skill and following its procedure. If you stashed changes, restore them: `git stash pop`.
2. For each issue `#<N>` in the supplied order:
   a. From the 2nd issue onward: run `pnpm josh ms` to incorporate the previous PR's merge (a `fullrun` always ends on the default branch, so this is defensive — it also handles the case where the previous iteration was interrupted before `pnpm josh ms` ran).
   b. Execute the full `fullrun #<N>` flow: normalize title → add `in-progress` label → post plan if body is blank → implement → run the verification gate (refactor → `pnpm josh gate` (lint, type check, spell check and unit tests, run concurrently) → `/code-review` at the level `pnpm josh review:level` prints on `git diff main`, iterating until no high/medium findings remain — **at most two reviews in total** (`prompts/review.md` → "Review round cap") → `pnpm josh eval:scope`, and `pnpm josh eval` when it answers `required` (`eval-gate.md`)) → `pnpm josh bump minor` → `pnpm josh git -y "<title> #<N>"` → `pnpm josh followup "<title> #<N>" --merge --notify-message "Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n- ..."` (sends per-issue completion notification and merges, exactly as `fullrun` does) → `pnpm josh ms` (return to the default branch).
   c. On failure: send a `failure` Telegram notification via `pnpm josh notify --task-type failure --issue-url "<issue-url>" --body="<reason>"` and **stop immediately** (do not proceed to the next issue).
3. No extra batch summary notification — each issue's `pnpm josh followup --merge` already sends the per-issue completion notification as usual. The final iteration's `pnpm josh ms` leaves the working tree on the default branch, so `queue` always ends on the default branch.

**Key rules:**

- Invoking `queue` is explicit authorization to merge each PR (same as `fullrun`).
- `josh latest` runs only once, before the first issue. If files were pre-staged when `queue` was invoked, they must be stashed before `josh latest` and restored after.
- All `kickoff`/`fullrun` mid-workflow stop rules (confirmation notification, AI review blocker handling, etc.) apply within each issue's execution.

