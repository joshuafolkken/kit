# `/code-review` → `followup` chain rule (MANDATORY)

## Run the review-to-merge chain

This is the execution contract for `fullrun` and `backlogrun`, and for `prrun` up to the pull request: a `prrun` never issues `pnpm josh ship` or a merging `pnpm josh followup` — it opens the pull request with `pnpm josh git -y` and ends by `prrun.md` → "The difference — the end of the run". The record below is reference only.
Review results and successful pushes are never turn boundaries.

0. **A lane child** (no `main:merge`: ship's sync merges main, stopping `conflict`): the self-check (`prompts/review.md` → "Before round 1 —
   the implementer's self-check"), `pnpm josh check:related`, `pnpm josh run:review` — its `--join`'s `test:pinned` lines
   answer the self-check's question 1 — the ship body draft filled in beside the gate (`report-format.md` → "PR
   本文の受け入れ条件の対応表"), then its `/code-review` subagent (as `run:review` prints) — on two briefs, two `reviewer`s side by side, the second recorded with `review:record --interaction --issue <N>` — not backgrounded — a turn end kills it — then `run:review --join`, `review:attest --check`, the
   round's fixes, no `check:related` after them unless a brief follows, `pnpm josh review:record --issue <N> [<finding> ...]` (round 2 stays ship's; it stamps the fixed tree, so ship reuses this round 1 and round 2 reads what moved since, unless round 2 would skip a move — never reopen `run:review`, which refuses it; on `Interaction review now due`, record that pass before the ship, running it first if none ran beside round 1; on `test:pinned restarted`, go on to the ship without waiting — its pre-detach reads that check), `pnpm josh ship --detach --review "<title> #<N>"`
   (`--cite <N>`; `--unpinned-ok "<reason>"` when `run:review` needed it). On `launched` with
   `pnpm josh cost --cut` `under`, run `pnpm josh ship:wait <N>` (`timeout` 600000) and follow
   it (`docs/josh-commands-run.md` → "`josh ship:wait`"); else, or on `busy`, **end the turn**. No `pnpm josh gate`,
   `check:related`, `check` or `metrics` before it or a re-detach, by hand: ship reuses the scoped
   pair green on this tree and base (no fix, main unmoved) and runs the gate after its sync (`scripts/run/ship/run-ship-steps.ts`); a standalone `check` or
   `metrics` leaves no record it reuses. A stop no session waits on relaunches a child
   whose prompt carries the failed output's tail and the changed files (`pnpm josh ship --log <N>` when
   the stage printed nothing), on a review stop the sweep of each finding's other sites the stop note
   directs, and (Anthropic lane) the re-detach to run after the fix — `pnpm josh ship --detach`, `--review` only if the stopped ship carried it and stopped before
   round 2, which is final, or the review went stale (`scripts/run/ship/run-ship-next.ts`).
   A preflight stop `unplanned: <files>` → take one of the two ways out it prints, then re-detach
   — unless its `lane:plan` answers `yield` (`docs/josh-commands-run.md` → "`josh ship`").
   `failed` → step 1.
1. Run `pnpm josh main:merge`. **Then issue `pnpm josh run:cut <N>` alone, before `check:related` and
   the gate** — the pre-gate cut (a no-op outside a lane). Then answer the self-check
   (`prompts/review.md` → "Before round 1 — the implementer's self-check"), its question 1 left to
   `run:review --join`, run the final scoped lint/test pair with `pnpm josh check:related` and
   `pnpm josh run:review`: it starts `pnpm josh test:pinned` and `pnpm josh gate` in the background
   and writes the `/code-review` brief to a file, printing its path and prompt, in one call, so they overlap; two briefs take two `reviewer`s side by side, the second recorded with
   `review:record --interaction`. Launch the `/code-review` subagent as the `reviewer`
   agent type (`kit:reviewer` in a consumer) with that prompt verbatim and its `model` — the alias of the `model=` id the brief prints (`claude-opus-5-5` → `opus`)
   (`.claude/agents/reviewer.md`; never a guessed type name).
   Never load the review skill in the main line.
2. Once the review returns, run `pnpm josh run:review --join` to join and read the gate before
   committing (`--join --fixing` if round 1 has fixes to make); it exits non-zero on a red gate, `3` on an `unpinned` line (its note names the `--unpinned-ok` call). Fix any red check, then rerun the affected scoped check
   and gate. Never version-bump a child (`pnpm josh release` decides).
3. Before acting on any review round, run `pnpm josh review:attest --check`. `missing` or `mismatch`
   discards it without counting; rerun against the brief's checkout. A review error receives a
   `confirmation` Telegram and stops.
4. Route the attested verdict mechanically:
   - Clean or Low-only round 1: no second round. Fix, file, or drop each Low with a one-line reason.
   - High/Medium round 1: fix it, then ask `pnpm josh review:round2 --round-1-closed`. On `skip`, record
     the skip on the Issue. On `required`, open the PR first and run round 2 from
     `pnpm josh review:brief --round 2` beside CI as `reviewer-verification` (`kit:` in a consumer).
   - Round 2 is final. Fix a branch-1 finding, run its scoped check, push it, then run the gate. Dispose
     of remaining non-High findings; a confirmed High blocks and receives a `confirmation` Telegram.
   Outside step 0, round-1 fixes run one scoped check and the gate before `git -y`.
   Once a round's verdict is attested, record its findings with `pnpm josh review:record --issue <N>
   ['<category>:<severity>:<file> — <reason>' ...]` (each one quoted argument; none if clean). **A round 2 that
   passes takes `--comment`** (`observation-ledger.md` → "The commit path").
   **`pnpm josh followup` refuses the merge until the round is recorded**
   (`pnpm josh review:record --check --issue <N>`).
5. **The clean path ships in one call** — with no second round due, background
   `pnpm josh ship "<title> #<N>" --body-file <evidence.md>` — the file carries `## 実機証跡` and
   `## 受け入れ条件の対応` (`report-format.md`), both asked at the preflight: PR preflight → gate → `git -y` →
   `followup` → `run:tail`, stopping at the first failure. `--review` runs both rounds. **Else a due
   round 2 does not fit `ship`**: the PR opens between the rounds — background
   `pnpm josh git -y "<title> #<N>"`, round 2 beside CI, then `pnpm josh followup`.

A lane child may end once, at step 0 or the pre-gate cut (`pre-gate-cut.md`); never at the push. The chain otherwise stops only when the PR is merged, the completion Telegram was sent, and
`run:tail` returned to the default branch, or when user judgment is required by an unverifiable
CodeRabbit/Claude Review finding or a CI failure. In a lane the parent closes it. Managed config claims are reported by `followup` and do not stop the merge.

Recommendations are informational; severity decides. A CodeRabbit rate-limit warning is not a finding.

## Orchestration facts single-sourced here

These are the gate → review → PR → merge facts other documents cite; this file is their single source
(`prompts/review.md` carries the review _policy_, `prompts/review-rubric.md` the rubric).

- **The gate runs beside this review, not in front of it** — started with the review, joined before the
  commit. A red gate is fixed and re-run whatever the review concluded.
- **origin/main is merged in before the gate** — `pnpm josh main:merge` (in a lane, ship's sync) is the last edit, so the scoped
  pair and the gate run once over it (in a lane, ship's, after `run:review`'s over the unmerged tree); a conflict fires `backlogrun-recovery.md` → "Conflicts are not
  predicted" early. **This is the one place a conflicted merge's procedure is written**: `main:merge`
  refuses when uncommitted changes touch a path the default branch also changed, or the index holds
  unresolved or staged paths — commit first with `pnpm josh git -y`, rerun, and **never stash around the
  merge**. A merge stopped on a conflict: remove the markers, then `pnpm josh git -y` stages the
  resolution and records the merge commit — **Tier A**; a lane child never asks a person for `git add`.
  A lane child's resolution of ship's `conflict` stop: markers removed → the re-detach the stop
  prints (step 0), which records the merge commit and runs the scoped pair and the gate.
- **One related-check command answers once per tree** — while implementing re-run one check per edit
  (`lint:related` / `cspell:dot` / `test:related <file>`), then `pnpm josh check:related` once
  before `run:review`, a review round's fixes once after the last (in a lane, none after `run:review`); `check:related` is those three plus `check`. In kit `lint:related` reports a metrics total past the
  merge-base; accept it with its reason before `pnpm josh ship`, or its pre-detach check stops.
- **The pull request opens between the rounds, so CI runs beside round 2** — round 1 runs on the
  uncommitted tree and its High/Medium fixes land before the commit; the verification pass runs against
  the open pull request.
- **The round-2 fix commit is pushed before its gate** — `pnpm josh git -y` again, so the gate runs
  inside the CI wait and is joined before `pnpm josh followup`.
- **A clean second round issues the merge in the same turn** — `pnpm josh followup`, after any branch-2
  filing and `pnpm josh epic:bundle`. Clean: no confirmed High standing, nothing routed to branch 1.
- **The review runs in a subagent, never a main-line skill load** — `/code-review` through the `Agent`
  tool, as the agent type step 1 names.
- **The brief names the checkout, and a review that read another one is refused** — `pnpm josh
  review:brief` prints the checkout root, branch, HEAD and a nonce; the review runs `pnpm josh
  review:attest <nonce>` from the tree it read, and `pnpm josh review:attest --check` must answer `ok`
  before anything acts on the verdict.

This file is the single source of the gate → review → PR → merge chain rule; other documents reference
it rather than restating it. `prompts/collaboration-workflow/plan-comment.md` keeps Step 3.
