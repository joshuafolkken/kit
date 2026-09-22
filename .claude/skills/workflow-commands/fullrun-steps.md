# `fullrun` — the step lists and the branches

**This is the detailed procedure behind `fullrun.md`'s manifest, relocated here so the entry read
carries the manifest, not the prose** (joshuafolkken/kit#2189). `fullrun.md` is the resident manifest;
it routes here for the fine print of a step, read on demand — `pnpm josh run:next <N>` names which step
the run is at, and the sections below carry that step in full.

## The `fullrun #N` step list

**Add `in-progress` the moment `run:hold` answered `hold`** (create if missing:
`gh api repos/{owner}/{repo}/labels -f name=in-progress -f color=0075ca -f description="Work is
actively in progress" --silent 2>/dev/null || true`, then `gh api
repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=in-progress'`) → Read Issue #N and its comments
(`issue-comments.md`) → **normalize the title** (if not in English or can be phrased more clearly,
derive a better English title and `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"`)
→ post the agreed plan only if the Issue body is blank (`gh api -X PATCH
repos/{owner}/{repo}/issues/<N> -f body="<plan>"`); if the body already has content, skip the
plan-posting step → implement → run the **verification gate** (the full procedure is `chain-rule.md`;
in outline: refactor → `pnpm josh main:merge` → `pnpm josh run:cut <N>` (the pre-gate cut, before the
gate; a no-op outside a lane) → start `pnpm josh gate` and a subagent `/code-review`
with the brief `pnpm josh review:brief` prints on `git diff main`, join the gate before the commit,
iterate to no high/medium findings, at most two reviews → open the PR between the rounds with `pnpm
josh git -y "<title> #<N>"` → the follow-up filing and `pnpm josh epic:bundle` inside the CI wait →
`pnpm josh followup`). Issue plan comments are written in the session language (`JOSH_SESSION_LANG`,
default `ja`). Before implementing, run `git switch main && git pull`, then `pnpm josh latest:scope`
and update dependencies only on `required` — `latest-gate.md` is its single source, and on `required`
load the `dependency-update` skill afterwards. **A dispatched lane child skips the `git switch main &&
git pull`**: `git switch main` is refused in a lane (the primary checkout holds the default branch, so
the switch fails with `already used by worktree`), the lane was branched from a fresh default before it
opened, and the latest default is brought in during the gate by `pnpm josh main:merge`. The parent runs
`git switch main && git pull` in the primary checkout, never the child — `backlogrun-lanes.md` and
`backlogrun-child.md` are the single sources. When running `pnpm josh followup`, pass an
implementation summary via `--notify-message` in the session language, leading with the three
plain-language lines: `"Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n-
<change1>\n- <change2>"`. **`pnpm josh followup` waits for CI, verifies AI review findings, sends the
completion notification, then merges; if blockers are found it exits non-zero — fix and re-run.**
**After the merge succeeds, run `pnpm josh ms`** to return to the default branch and pull the merge
commit (`followup.md` → `auto-merge`).

## The `fullrun new` step list

`kickoff new` + `fullrun #N` in one run. Steps: (1) Derive an English title, or use the provided one.
**(1a) Run `pnpm josh issue:scout "<title>" [--body "<summary>"]` before creating the Issue** — a
candidate that covers the same work stops the run rather than filing a second Issue (`SKILL.md` → §2e).
(2) Create Issue: `gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=depth:<n>' -f
body="<body>"` (body per `prompts/collaboration-workflow/issue-template.md`). Capture `<N>`. (3) Add
`in-progress` (as above). (4) Post the agreed plan in the session language: fill the body if blank,
otherwise add a comment. (5) If the working tree already has staged or modified files,
`git stash push -m "fullrun new: pre-existing changes"` first. (6) `git switch main && git pull`. (7)
`pnpm josh latest:scope`; on `required` run `josh latest` and load the `dependency-update` skill; on
`skip` neither runs (`latest-gate.md` is the single source). If you stashed in (5),
`pnpm josh stash:pop "fullrun new: pre-existing changes"` — by message, never a positional `git stash
pop`. (8) Implement. (9) Run the verification gate (as in `chain-rule.md`; only the first review round
runs here). (9a) **Ask `pnpm josh review:round2 --round-1-closed` whether a second round is due**, once
round 1's fixes are in and before the commit. (10) Where the tree was edited after the first gate
started, re-run `pnpm josh gate` and join it. (11) `pnpm josh git -y "<title> #<N>"` — the pull request
opens here, between the two rounds. (11a) Run the **second round** now beside the CI, where (9a)
answered `required` (brief `pnpm josh review:brief --round 2`); a finding it fixes in place is pushed
before its gate. (12) File whatever the review round cap routed to branch 2, run `pnpm josh epic:bundle
<new>` on each, and where (9a) answered `skip` record the skip on the Issue. (13) `pnpm josh followup
"<title> #<N>" --notify-message "..."`. (14) **After the merge, run `pnpm josh ms`.** (15) **Ask `pnpm
josh release:scope` and close the completion summary with what it answered** (`followup-reference.md` →
"When `pnpm josh release` runs").

## The release ask — the last step of either form

Once the merge is done, `pnpm josh release:scope` says whether a release is owed — `required`, `skip`
or `unknown`, and `unknown` is never read as `skip`. On `required` the completion summary closes with
the request and the exact command; the run never types `pnpm josh release` itself, because publishing
is Tier C (`followup-reference.md` → "When `pnpm josh release` runs", the single source). A `fullrun`
invoked as one child of a `backlogrun` does not ask it — that batch asks once at its own end.
