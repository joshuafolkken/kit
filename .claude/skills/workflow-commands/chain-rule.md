# `/code-review` → `followup` chain rule (MANDATORY)

## Run the review-to-merge chain

This is the execution contract for `fullrun` and `backlogrun`, and for `prrun` up to the pull request: a `prrun` never issues `pnpm josh ship` or a merging `pnpm josh followup` — it opens the pull request with `pnpm josh git -y` and ends by `prrun.md` → "The difference — the end of the run". The record below is reference only.
Review results and successful pushes are never turn boundaries.

1. **Issue `pnpm josh run:cut <N>` alone first** — the pre-gate cut (a no-op outside a lane). Then
   `pnpm josh run:chain <N>` in one Bash call (`timeout` 600000), the self-check (`prompts/review.md` →
   "Before round 1 — the implementer's self-check") answered before the scoped lint/test pair it runs;
   follow what it prints — its stages
   (`scripts/run/review/run-chain.ts`), a stop's `next:` line (`--from <stage>` resumes) and
   `run:review`'s brief paths and prompts (`scripts/run/review/run-review-cli.ts`). Launch the
   `/code-review` subagent as the `reviewer` agent type (`kit:reviewer` in a consumer) with that prompt
   verbatim and its `model` — the alias the brief prints beside its `model=` id (`(opus)` → `opus`)
   (`.claude/agents/reviewer.md`; never a guessed type name).
   Never load the review skill in the main line.
2. Once the review returns, `pnpm josh run:chain <N> --join` (`--fixing`: round-1 fixes); follow what
   it prints (`scripts/run/review/run-chain-join.ts`). A complete green gate and pinned answer with no
   unplanned files on the same tree return without waiting; every miss uses the normal join and its
   exit codes. Attestation and finding disposition still follow. `lane:breakdown` counts the halves as
   `run:chain open` and `run:chain join`. Never version-bump a child (`pnpm josh release` decides).
3. A round for which `review:attest --check` answers `missing` or `mismatch` is discarded uncounted; rerun
   against the brief's checkout. A review error receives a `confirmation` Telegram and stops.
4. Route the attested verdict mechanically:
   - Full-change final brief: apply round 2's disposition; record with `--comment`.
     Interaction stays independent.
   - Clean or Low-only round 1: no second round. Fix, file, or drop each Low with a one-line reason.
   - High/Medium round 1: fix and record it (below), then `ship --review` (step 5) asks
     `review:round2 --record <N>` and runs a due round 2 as `reviewer-verification`.
   - Round 2 is final. Fix a branch-1 finding, run its scoped check, push it, then run the gate. Dispose
     of remaining non-High findings; a confirmed High blocks and receives a `confirmation` Telegram.
   After the last pre-commit review fix: `pnpm josh test:related --touched` once.
   Record an attested round's findings with `pnpm josh review:record --from-slot
   --issue <N>` (dispositions: its usage). **A round 2 that
   passes takes `--comment`** (`observation-ledger.md` → "The commit path").
5. **The clean path ships in one call** — with no second round due, background
   `pnpm josh ship "<title> #<N>"` — its body draft carries `## 実機証跡`
   (`pnpm josh ship:evidence` fills it) and `## 受け入れ条件の対応` (`report-format.md`), both asked at the preflight: PR preflight → gate → `git -y` →
   `followup` → `run:tail`, stopping at the first failure. With a due round 2, use `ship --review`:
   after sync and round 1, round 2 runs beside the gate and joins before the commit opens the PR.

A lane child session ends at step 0, a pre-gate cut (`pre-gate-cut.md`) or a review-fix cut; never at the push. The chain otherwise stops only when the PR is merged, the completion Telegram was sent, and
`run:tail` returned to the default branch, or when user judgment is required by an unverifiable
CodeRabbit/Claude Review finding or a CI failure. In a lane the parent closes it. Managed config claims are reported by `followup` and do not stop the merge.

Recommendations are informational; severity decides. A CodeRabbit rate-limit warning is not a finding.

## A lane child — step 0

0. **A lane child** (no `main:merge`: ship's sync merges main, stopping `conflict`): the self-check (`prompts/review.md` → "Before round 1 —
   the implementer's self-check"; 1: `--join`'s `test:pinned`, 2/4/10: `review:selfcheck`), `pnpm josh run:chain <N>` (a metrics notice → its verdict line) —
   the ship body draft's rows a green `test:related` left pending filled in beside the gate (`report-format.md` → "PR
   本文の受け入れ条件の対応表"), then its `/code-review` subagent (as `run:review` prints) — on two briefs, two `reviewer`s side by side, the second recorded with `review:record --from-slot --interaction --issue <N>` before the join that ships — not backgrounded — a turn end kills it — then `pnpm josh run:chain <N> --join --ship "<title> #<N>"` (step 2; clean records and ships with `--detach --review`; every finding holds before recording or shipping, fixed in a fresh session: the hold's `run:cut --impl`), the
   round's fixes, no `check:related` after them unless a brief follows (one before `--join` is refused, `round-one-check-related`), on a held finding `pnpm josh review:record --from-slot --issue <N>` (round 2 stays ship's; it stamps the fixed tree, so ship reuses this round 1 and round 2 reads what moved since, unless round 2 would skip a move — never reopen `run:review`, which refuses it; a `lane:plan` widened after round 1 → the ship, whose `--review` reads the widened files (`review-lane-handover.ts`); on `Interaction review now due`, record that pass before the ship, running it first if none ran beside round 1; on `test:pinned restarted`, go on to the ship without waiting — its pre-detach reads that check), `pnpm josh ship --detach --review "<title> #<N>"`
   only after that hold is settled; use plain `--join` then this ship when additional ship options are needed
   (`--cite <N>`; `--unpinned-ok "<reason>"` when `run:review` needed it; `timeout` 600000 for either shipping call). On either shipping path, `launched` runs
   `cost --cut` and, on `under`, one `ship:wait <N>` chunk; follow it
   (`docs/josh-commands-run.md` → "`josh ship:wait`"); on `busy`, **end the turn**. No `pnpm josh gate`,
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

## Orchestration facts single-sourced here

These are the gate → review → PR → merge facts other documents cite; this file is their single source
(`prompts/review.md` carries the review _policy_, `prompts/review-rubric.md` the rubric).

- **The gate runs in front of round 1** — `run:review` prints the gate's note and writes no brief on
  any gate state but green (step 1); round 2 runs beside the ship's gate.
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
  (`lint:related` / `cspell:dot` / `test:related --touched`), one full-reach `test:related` once the
  implementation is done (`docs/josh-commands.md` → "`josh test:related`"), then `pnpm josh check:related` once
  before `run:review`; ship's scoped pair runs full reach after review fixes; `check:related` is those three plus `check`. In kit `lint:related` reports a metrics total past the
  merge-base; accept it with its reason before `run:review`, whose open stops on it (the ship's pre-detach check is the backstop).
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

`prompts/collaboration-workflow/plan-comment.md` keeps Step 3.
