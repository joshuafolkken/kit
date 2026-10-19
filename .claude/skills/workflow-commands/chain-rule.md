# `/code-review` → `followup` chain rule (MANDATORY)

## Run the review-to-merge chain

This is the execution contract for `fullrun` and `backlogrun`, and for `prrun` up to the pull request: a `prrun` never issues `pnpm josh ship` or a merging `pnpm josh followup` — it opens the pull request with `pnpm josh git -y` and ends by `prrun.md` → "The difference — the end of the run". The record below is reference only.
Review results and successful pushes are never turn boundaries.

0. **A lane child**: `pnpm josh main:merge`, the self-check (`prompts/review.md` → "Before round 1 —
   the implementer's self-check"), the scoped pair, `pnpm josh ship --detach --review
   "<title> #<N>"` (`--cite <N>`), then **end the turn** on `launched`/`busy`. A stop relaunches a child
   whose prompt carries the failed output's tail and the changed files (`pnpm josh ship --log <N>` when
   the stage printed nothing) and (Anthropic lane) the re-detach to run after
   the fix — `pnpm josh ship --detach`, `--review` only if the stopped ship carried it and stopped before
   round 2, which is final (`scripts/run/ship/run-ship-next.ts`); the supervisor skips a recorded round 1.
   `failed` → step 1. A backgrounded `ship` issued alone is moved to the foreground by the hook
   rather than refused.
1. Run `pnpm josh main:merge`. **Then issue `pnpm josh run:cut <N>` alone, before the scoped pair and
   the gate** — the pre-gate cut (a no-op outside a lane). Then answer the self-check
   (`prompts/review.md` → "Before round 1 — the implementer's self-check"), run the final scoped lint/test pair and
   `pnpm josh run:review`: it starts `pnpm josh gate` in the background and prints the `/code-review`
   brief in one call, so the two overlap. Launch the `/code-review` subagent as the `general-purpose`
   agent type with that brief and its `model` (`delegation.md`) (every tool, so `--fix` applies;
   never a guessed type name).
   Never load the review skill in the main line.
2. Once the review returns, run `pnpm josh run:review --join` to join and read the gate before
   committing; it exits non-zero on a red gate. Fix any red check, then rerun the affected scoped check
   and gate. Never version-bump a child (`pnpm josh release` decides).
3. Before acting on any review round, run `pnpm josh review:attest --check`. `missing` or `mismatch`
   discards it without counting; rerun against the brief's checkout. A review error receives a
   `confirmation` Telegram and stops.
4. Route the attested verdict mechanically:
   - Clean or Low-only round 1: no second round. Fix, file, or drop each Low with a one-line reason.
   - High/Medium round 1: fix it, then ask `pnpm josh review:round2 --round-1-closed`. On `skip`, record
     the skip on the Issue. On `required`, open the PR first and run the verification pass from
     `pnpm josh review:brief --round 2` beside CI.
   - Round 2 is final. Fix a branch-1 finding, run its scoped check, push it, then run the gate. Dispose
     of remaining non-High findings; a confirmed High blocks and receives a `confirmation` Telegram.
   Any round-1 fix runs its affected scoped check and the gate before `git -y`.
   Once a round's verdict is attested, record its findings with `pnpm josh review:record --issue <N>
   [<category>:<severity>:<file> ...]` — a clean round records one zero-finding line. **A round 2 that
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
- **origin/main is merged in before the gate** — `pnpm josh main:merge` is the last edit, so the scoped
  pair and the gate run once over it; a conflict fires `backlogrun-recovery.md` → "Conflicts are not
  predicted" early. **This is the one place a conflicted merge's procedure is written**: `main:merge`
  refuses when uncommitted changes touch a path the default branch also changed, or the index holds
  unresolved or staged paths — commit first with `pnpm josh git -y`, rerun, and **never stash around the
  merge**. A merge stopped on a conflict: remove the markers, then `pnpm josh git -y` stages the
  resolution and records the merge commit — **Tier A**; a lane child never asks a person for `git add`.
- **A single check answers once per tree** — re-run one check by name (`pnpm josh lint:related`,
  `pnpm josh cspell:dot`, `pnpm josh test:related`, or the type check) after every edit, never twice
  over an untouched tree. In kit a detached `pnpm josh ship` also checks the metrics totals; accept a
  grown total with its reason, as its output names.
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
