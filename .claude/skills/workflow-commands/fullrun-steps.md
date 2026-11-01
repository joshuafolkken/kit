# `fullrun` — the step lists and the branches

`pnpm josh run:next <N>` names which step the run is at, and the sections below carry that step in
full.

## The `fullrun #N` step list

File Issues with `pnpm josh issue:file` (it applies the classification labels); see `prompts/collaboration-workflow/issue-template.md`.

1. **`in-progress` is already on the Issue** — `run:entry` applied it once the tree was held and the
   budget allowed the run, and `run:release <N>` takes it back off.
2. Read the Issue and its comments off `run:entry`'s `run:prep` report (`issue-comments.md`).
3. **Record the agreed plan** with `pnpm josh issue:plan <N> --body-file <path>`, adding
   `--title "<title>"` when the title is not in English or can be phrased more clearly (the plan goes
   into the body when it is blank and its author has write access, otherwise into a comment; its
   `### 影響を受ける既存の利用者` section is drafted with `pnpm josh plan:consumers` — `kickoff.md` step 4).
   In a lane child it runs `lane:plan` on the plan's paths: `docs/josh-commands-backlog.md` → "`josh issue:plan`".
4. Synchronize as `entry-sequence.md` → "The ordered entry sequence" directs, then update dependencies only where the `run:prep` report answers
   `latest: required` — `latest-gate.md` is its single source. Load the `dependency-update` skill
   after an update. **A dispatched lane child skips entry synchronization**; ship syncs before its gate.
5. Implement. The `plan` event `run:board` draws 📝 from is written by code — by `run:entry` for a
   `run:planned` issue, else at the first implementation edit — never by hand; no cut follows the
   plan — a lane child's context is bounded by the threshold-gated implementation cut alone.
6. Run the **verification gate** through the merge: `chain-rule.md` → "Run the review-to-merge
   chain". Branch-2 filing (`pnpm josh issue:file`, which runs `epic:bundle` itself) runs before
   `pnpm josh ship`.
7. When running `pnpm josh followup`, pass an implementation summary via `--notify-message` in the
   session language, leading with the three plain-language lines: `"Implemented <title>\nCause:
   ...\nFix: ...\nResult: ...\n\nDetails:\n- <change1>\n- <change2>"`. **`pnpm josh followup` waits
   for CI, verifies AI review findings, sends the completion notification, then merges; if blockers
   are found it exits non-zero — fix and re-run.**
8. `run:tail` returns the primary checkout to the default branch (`main:sync`) after the merge;
   every linked checkout skips that step and keeps its branch and port seat.

## The `fullrun new` step list

`kickoff new` + `fullrun #N` in one run. Steps: (1) Derive an English title, or use the provided one.
(2) Create Issue: `pnpm josh issue:file "<title>" --body-file <body-file>`,
with the labels `kickoff.md` → "Words typed after `new`" maps (per
`prompts/collaboration-workflow/issue-template.md`) — its duplicate scan runs first, and a candidate
that covers the same work stops the run rather than filing a second Issue (`issue-scout.md`). Capture
`<N>`. (3) `pnpm josh run:hold --adopt <N>` — re-keys the bare hold to `<N>` and applies `in-progress`;
every later stop releases with `run:release <N>`. (4) Record the agreed plan
in the session language: `pnpm josh issue:plan <N> --body-file <path>` (its consumers section as in
`kickoff.md` step 4). (5) `pnpm josh stash:push "fullrun new: pre-existing changes"`. (6) Synchronize per `entry-sequence.md`. (7)
`pnpm josh run:prep <N>`; on `latest: required` run `pnpm josh latest:if-required` and load the `dependency-update`
skill; on `skip` neither runs (`latest-gate.md` is the single source). If (5) answered `stashed`,
`pnpm josh stash:pop "fullrun new: pre-existing changes"`. (8) Implement. (9) Run round 1 of the verification chain (`chain-rule.md` → "Run the review-to-merge
chain"). (10) File whatever the review round cap routed to branch 2 with `pnpm josh issue:file` (it
runs `epic:bundle` on each). (11) Ship in one call — `pnpm josh ship "<title> #<N>" --notify-message
"..."`, or `pnpm josh ship --review "<title> #<N>" --notify-message "..."` after a High/Medium round 1:
it asks `review:round2 --record <N>` itself and runs a due round 2 beside the gate, before the commit
(the same chain step 5). (12) **Close the completion summary with `run:tail`'s `release:scope`
answer** (`followup.md` → "When `pnpm josh release` runs").

## The release ask — the last step of either form

**One call folds the post-merge bookkeeping**: after the merge, `pnpm josh
run:tail <N>` commits ledger lines written outside any issue's run (`observations:flush`), reads the
completion citations (`issue:cite`, given the closed issue and any follow-ups filed this run) and
decides the release scope (`release:scope`) in one round trip, joining each under its own header. **`run:tail`
runs inside `pnpm josh ship`** as its report step, with or without `--review`. It folds only bookkeeping — the
release ask below stays the single source of what `required` means and the Tier-C publish boundary; a
`backlogrun` child leaves `observations:flush` to each drain marker in
`backlog:offer` (`scripts/backlog/backlog-offer-cli.ts`): before the marker is written it synchronizes
the primary checkout to the default branch and awaits the flush, ahead of the retrospective; a failure
prints one line and keeps the batch ending. `issue:cite` and the release ask remain the batch's own end.

Once the merge is done, `pnpm josh release:scope` says whether a release is owed — `required`, `skip`
or `unknown`, and `unknown` is never read as `skip`. On `required` the completion summary closes with
the request and the exact command; the run never types `pnpm josh release` itself, because publishing
is Tier C (`followup.md` → "When `pnpm josh release` runs", the single source). A `fullrun`
invoked as one child of a `backlogrun` does not ask it — that batch asks once at its own end.
