# `fullrun` — the step lists and the branches

**The detailed procedure behind `fullrun.md`'s manifest**, read on demand — `pnpm josh run:next <N>`
names which step the run is at, and the sections below carry that step in full. History:
`docs/maintainers/fullrun-steps-rationale.md` → "Where each rule came from".

## The `fullrun #N` step list

File Issues with `pnpm josh issue:file` (it applies the classification labels); see `prompts/collaboration-workflow/issue-template.md`.

**`in-progress` is already on the Issue** — `run:entry` applied it once the tree was held and the
budget allowed the run, and `run:release <N>` takes it back off → Read Issue #N and its comments
(`issue-comments.md`) → **normalize the title** (if not in English or can be phrased more clearly,
derive a better English title and `gh api -X PATCH repos/{owner}/{repo}/issues/<N> -f title="<title>"`)
→ post the agreed plan only if the Issue body is blank (`gh api -X PATCH
repos/{owner}/{repo}/issues/<N> -f body="<plan>"`); if the body already has content, skip the
plan-posting step → implement (the `plan` event `run:board` draws 📝 from is written by code — by
`run:entry` for a `run:planned` issue, else at the first implementation edit — never by hand; no cut
follows the plan — a lane child's context is bounded by the
threshold-gated implementation cut alone) → run the **verification gate** (the full procedure is `chain-rule.md`;
in outline: refactor → `pnpm josh main:merge` → **a dispatched lane child hands the rest to
`pnpm josh ship --detach --review "<title> #<N>"` and ends its turn** (`chain-rule.md` step 0) → otherwise `pnpm josh run:cut <N>` (the pre-gate cut, before the gate; a no-op
outside a lane) → start `pnpm josh gate` and a subagent `/code-review`
with the brief `pnpm josh review:brief` prints on `git diff main`, join the gate before the commit,
iterate to no high/medium findings, within the round cap (`prompts/review.md`) → **the clean path folds the ship region into
one call**, `pnpm josh ship "<title> #<N>"` (gate → commit/push/PR → the CI-wait `followup` → the
`run:tail` report bookkeeping, stopping at the first failed step), with any
branch-2 filing (`pnpm josh issue:file`, which runs `epic:bundle` itself) run before it → **when a second round is due `ship` does not
fit**: open the PR between the rounds with `pnpm josh git -y "<title> #<N>"`, run round 2 beside CI, then
`pnpm josh followup` and `pnpm josh run:tail <N>`). Issue plan comments are written in the session language (`JOSH_SESSION_LANG`,
default `ja`). Before implementing, run `pnpm josh ms`, then `pnpm josh latest:scope`
and update dependencies only on `required` — `latest-gate.md` is its single source, and on `required`
load the `dependency-update` skill afterwards. **A dispatched lane child skips `pnpm josh ms`** — it
refuses in a lane, and `pnpm josh main:merge` brings the latest default in during the gate
(`docs/maintainers/fullrun-steps-rationale.md` → "Why a lane child skips `josh ms`"). The parent runs
`pnpm josh ms` in the primary checkout, never the child — `backlogrun-lanes.md` and
`backlogrun-child.md` are the single sources. When running `pnpm josh followup`, pass an
implementation summary via `--notify-message` in the session language, leading with the three
plain-language lines: `"Implemented <title>\nCause: ...\nFix: ...\nResult: ...\n\nDetails:\n-
<change1>\n- <change2>"`. **`pnpm josh followup` waits for CI, verifies AI review findings, sends the
completion notification, then merges; if blockers are found it exits non-zero — fix and re-run.**
**Run `pnpm josh ms` after the merge.** A Codex lane skips it — the parent's `run:merge` syncs the
primary checkout; a Claude run keeps it.

## The `fullrun new` step list

`kickoff new` + `fullrun #N` in one run. Steps: (1) Derive an English title, or use the provided one.
(2) Create Issue: `pnpm josh issue:file "<title>" --body-file <body-file> --depth <n> --requested`,
with the labels `kickoff.md` → "Words typed after `new`" maps (per
`prompts/collaboration-workflow/issue-template.md`) — its duplicate scan runs first, and a candidate
that covers the same work stops the run rather than filing a second Issue (`issue-scout.md`). Capture
`<N>`. (3) Add `in-progress` (the bare hold named no issue):
`gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=in-progress'`. (4) Post the agreed plan
in the session language: fill the body if blank,
otherwise add a comment. (5) If the working tree already has staged or modified files,
`git stash push -m "fullrun new: pre-existing changes" -- ':!.josh/observations'` first. (6) `pnpm josh ms`. (7)
`pnpm josh latest:scope`; on `required` run `josh latest` and load the `dependency-update` skill; on
`skip` neither runs (`latest-gate.md` is the single source). If you stashed in (5),
`pnpm josh stash:pop "fullrun new: pre-existing changes"` — by message, never a positional `git stash
pop`. (8) Implement. (9) Run the verification gate (as in `chain-rule.md`; only the first review round
runs here). (9a) **Ask `pnpm josh review:round2 --round-1-closed` whether a second round is due**, once
round 1's fixes are in and before the commit. (10) Where the tree was edited after the first gate
started, re-run `pnpm josh gate` and join it. (11) `pnpm josh git -y "<title> #<N>"` — the pull request
opens here, between the two rounds. (11a) Run the **second round** now beside the CI, where (9a)
answered `required` (brief `pnpm josh review:brief --round 2`); a finding it fixes in place is pushed
before its gate. (12) File whatever the review round cap routed to branch 2 with `pnpm josh issue:file`
(it runs `epic:bundle` on each), and where (9a) answered `skip` record the skip on the Issue. (13) **Where no second
round was due** (9a `skip`), fold steps (10)–(13) and the release bookkeeping into one call — `pnpm josh
ship "<title> #<N>" --notify-message "..."` (gate → commit/push/PR → the CI-wait `followup` → `run:tail`,
stopping at the first failed step); **where a second round ran**, the PR opened
at (11) and the region stays separate — `pnpm josh followup "<title> #<N>" --notify-message "..."` then
`pnpm josh run:tail <N>`. (14) **After the merge, run `pnpm josh ms`.** (15) **Ask `pnpm josh
release:scope` and close the completion summary with what it answered** (`followup.md` →
"When `pnpm josh release` runs").

## The release ask — the last step of either form

**One call folds the post-merge bookkeeping**: after the merge, `pnpm josh
run:tail <N>` commits ledger lines written outside any issue's run (`observations:flush`), reads the
completion citations (`issue:cite`, given the closed issue and any follow-ups filed this run) and
decides the release scope (`release:scope`) in one round trip, joining each under its own header. **On
the clean path `run:tail` runs inside `pnpm josh ship`** as its report step, so it is a standalone call
only where a second round kept the ship region separate. It folds only bookkeeping — the
release ask below stays the single source of what `required` means and the Tier-C publish boundary; a
`backlogrun` child still leaves `observations:flush`, `issue:cite` and the release ask to the batch's
own end.

Once the merge is done, `pnpm josh release:scope` says whether a release is owed — `required`, `skip`
or `unknown`, and `unknown` is never read as `skip`. On `required` the completion summary closes with
the request and the exact command; the run never types `pnpm josh release` itself, because publishing
is Tier C (`followup.md` → "When `pnpm josh release` runs", the single source). A `fullrun`
invoked as one child of a `backlogrun` does not ask it — that batch asks once at its own end.
