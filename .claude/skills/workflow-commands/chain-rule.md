# `/code-review` → `followup` chain rule (MANDATORY)

## Run the review-to-merge chain

This is the execution contract for `fullrun` and `backlogrun`, and for `prrun` up to the pull request: a `prrun` never issues `pnpm josh ship` or a merging `pnpm josh followup` — it opens the pull request with `pnpm josh git -y` and ends by `prrun.md` → "The difference — the end of the run". The record below is reference only.
Review results and successful pushes are never turn boundaries.

0. **A lane child**: `pnpm josh main:merge`, the scoped pair, `pnpm josh ship --detach --review
   "<title> #<N>"` (`--cite <N>`), then **end the turn** on `launched`/`busy`. A stop relaunches a child
   whose prompt names `pnpm josh ship --log <N>` and (Anthropic lane) the re-detach to run after
   the fix — `pnpm josh ship --detach`, `--review` only if the stopped ship carried it and stopped before
   round 2, which is final (`scripts/run/ship/run-ship-next.ts`); the supervisor skips a recorded round 1.
   `failed` → step 1. A backgrounded `ship` issued alone is moved to the foreground by the hook
   rather than refused.
1. Run `pnpm josh main:merge`. **Then issue `pnpm josh run:cut <N>` alone, before the scoped pair and
   the gate** — the pre-gate cut (a no-op outside a lane). Then run the final scoped lint/test pair and
   `pnpm josh run:review`: it starts `pnpm josh gate` in the background and prints the `/code-review`
   brief in one call, so the two overlap. Launch the `/code-review` subagent as the `general-purpose`
   agent type with that brief (every tool, so `--fix` applies; never a guessed type name).
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
   `pnpm josh ship "<title> #<N>" --body-file <evidence.md>`: PR preflight → gate → `git -y` →
   `followup` → `run:tail`, stopping at the first failure. `--review` runs both rounds. **Else a due
   round 2 does not fit `ship`**: the PR opens between the rounds — background
   `pnpm josh git -y "<title> #<N>"`, round 2 beside CI, then `pnpm josh followup`.

A lane child may end once, at step 0 or the pre-gate cut (`pre-gate-cut.md`); never at the push. The chain otherwise stops only when the PR is merged, the completion Telegram was sent, and
`pnpm josh ms` returned to the default branch, or when user judgment is required by an unverifiable
CodeRabbit/Claude Review finding or a CI failure. In a lane `josh ms` refuses; the parent closes it. Managed config claims are reported by `followup` and do not stop the merge.

Recommendations are informational; severity decides. A CodeRabbit rate-limit warning is not a finding.

## Orchestration facts single-sourced here

These are the gate → review → PR → merge facts other documents cite; this file is their single source
(`prompts/review.md` carries the review _policy_, `prompts/review-rubric.md` the rubric). Where each
rule came from and why it holds: `docs/maintainers/chain-rule-rationale.md` → "Where each rule came
from", `docs/maintainers/chain-rule-rationale.md` → "Why the orchestration facts hold".

- **The gate runs beside this review, not in front of it** — `pnpm josh gate` is started when the review
  starts and joined before the commit. A red gate is fixed and re-run whatever the review concluded, and
  there is no path to a commit on a gate nobody read.
- **origin/main is merged in before the gate** — `pnpm josh main:merge` merges `origin/<default>` into
  the branch before the gate and the review start. It is the last edit, so the scoped pair and the gate
  run once over it. A conflict here fires `backlogrun-recovery.md` → "Conflicts are not predicted"
  early. **This is the one place a conflicted merge's procedure is written**:
  `main:merge` refuses before merging when uncommitted changes touch a path the default branch also
  changed, or when the index still holds unresolved or staged paths — commit the work first with
  `pnpm josh git -y`, then rerun it, and **never stash around the merge**. A merge that stops on a
  conflict is finished the same way: remove the markers, then `pnpm josh git -y` stages the resolution
  and records the merge commit. That commit is the sanctioned flow, so it is **Tier A** — a lane child
  never stops to ask a person for `git add`, and the `Stop` hook sends back a reply that does.
- **A single check answers once per tree** — while implementing, re-run a single check by name
  (`pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`, or the project's type
  check) after every edit; a repeat of the same command with the same arguments over a tree nothing has
  touched since buys only a copy of the answer already in hand. In kit a detached `pnpm josh ship` also
  checks the metrics totals before the hand-off, so the implementing session accepts a grown total with
  its reason, as the ship's output names.
- **The pull request opens between the rounds, so CI runs beside round 2** — `pnpm josh git -y` sits
  between the two review rounds. Round 1 runs on the uncommitted tree and its High/Medium findings are
  fixed before anything is committed; the verification pass over those fixes then runs against the open
  pull request, beside the CI the commit started.
- **The round-2 fix commit is pushed before its gate** — a fix the second round makes in place is
  pushed (`pnpm josh git -y` again, a follow-up commit) before its `pnpm josh gate`, so the gate runs
  inside the CI wait and is joined before `pnpm josh followup` rather than in front of it.
- **A clean second round issues the merge in the same turn** — the turn that reads a clean second round
  issues `pnpm josh followup`, after any branch-2 filing and `pnpm josh epic:bundle` and never in a turn
  of its own. Clean has two halves: no confirmed High is standing, and nothing was routed to branch 1 of
  the disposition.
- **The review runs in a subagent, never a main-line skill load** — `/code-review` is spawned through
  the `Agent` tool in its own context, as the agent type step 1 names.
- **The brief names the checkout, and a review that read another one is refused** — `pnpm josh
  review:brief` prints the checkout root, branch and HEAD and a nonce; the review runs `pnpm josh
  review:attest <nonce>` from the tree it read, and `pnpm josh review:attest --check` must answer `ok`
  before the run or `pnpm josh followup` acts on the verdict, or it is discarded.

This file is the single source of the gate → review → PR → merge chain rule; other documents reference
it rather than restating it. `prompts/collaboration-workflow/plan-comment.md` keeps Step 3.
