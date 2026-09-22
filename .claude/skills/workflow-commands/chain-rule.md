# `/code-review` → `followup` chain rule (MANDATORY)

## Run the review-to-merge chain

This is the execution contract for `fullrun` and `backlogrun`; the record below is reference only.
Review results and successful pushes are never turn boundaries.

1. Run `pnpm josh main:merge`. **Then issue `pnpm josh run:cut <N>` before the scoped pair and the
   gate** — the pre-gate cut, ordered here so a lane child takes it before the gate rather than after a
   refusal (joshuafolkken/kit#2177). It is a no-op outside a lane and cuts inside one; on `cut` the turn
   ends and a fresh process resumes at the gate, and because the cut is issued on its own it never
   batches with a call a refusal could collateral. The `pre-gate-cut.md` refusal stays as insurance.
   Then run the final scoped lint/test pair and `pnpm josh run:review`: it starts `pnpm josh gate` in
   the background and prints the whole `/code-review` brief in one call, so the gate and the review
   overlap rather than the review waiting on the gate (joshuafolkken/kit#2179). Launch the
   `/code-review` subagent as the `general-purpose` agent type with that brief — it carries every tool,
   so it can load the review skill and, with `--fix`, apply findings; a guessed type name fails with
   `Agent type not found` (joshuafolkken/kit#2297). Never load the review skill in the main line.
2. Once the review returns, run `pnpm josh run:review --join` to join and read the gate before
   committing; it exits non-zero on a red gate. Fix any red check, then rerun the affected scoped check
   and gate. Do not version-bump a child; `pnpm josh release` decides the version from main's history.
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
   [<category>:<severity>:<file> ...]` — a clean round is a call with no findings, which records one
   zero-finding line rather than nothing, so the recurrence count keeps its denominator
   (joshuafolkken/kit#2325). The line lands in the observation ledger, and the `pnpm josh followup`
   flush commits it; `pnpm josh review:findings` reads the category tally back.
5. After a green joined gate, background `pnpm josh git -y "<title> #<N>"`. Its completion resumes the
   same turn through branch-2 filing, `epic:bundle`, and `pnpm josh followup`. A clean round 2 merges;
   a round-2 fix is pushed before its gate, which is joined before `followup`.

A dispatched lane child may end once at the pre-gate cut in `pre-gate-cut.md`; it never ends at the
push. The chain otherwise stops only when the PR is merged, the completion Telegram was sent, and
`pnpm josh ms` returned to the default branch, or when user judgment is required by an unverifiable
CodeRabbit/Claude Review finding or a CI failure. In a lane, `josh ms` refusing is expected and the
parent closes the lane. Managed config claims are reported by `followup` and do not stop the merge.

Recommendations are informational; severity decides. A CodeRabbit rate-limit warning is not a finding.

## Orchestration facts single-sourced here

These are the gate → review → PR → merge facts other documents cite. This file is their single source
(joshuafolkken/kit#1927 moved them out of `prompts/review.md`, which now carries only the review
_policy_ — level, round cap, disposition — and `prompts/review-rubric.md` the rubric). Each is stated
once here; the measurements that motivated each one live in the linked Issues.

- **The gate runs beside this review, not in front of it** — `pnpm josh gate` is started when the review
  starts and joined before the commit; the two read the same tree and neither writes to it, so running
  them serially is pure waiting. A red gate is fixed and re-run whatever the review concluded, and there
  is no path to a commit on a gate nobody read (joshuafolkken/kit#1242).
- **origin/main is merged in before the gate** — `pnpm josh main:merge` merges `origin/<default>` into
  the branch before the gate and the review start, so the gate verifies the tree that will actually
  merge rather than one that never existed (joshuafolkken/kit#1837). It is the last edit, so the scoped
  pair and the gate run once over it. A conflict here fires `backlogrun-lanes.md` → "Conflicts are not predicted"
  early.
- **A single check answers once per tree** — while implementing, re-run a single check by name
  (`pnpm josh lint:related`, `pnpm josh cspell:dot`, `pnpm josh test:related`, or the project's type
  check) after every edit; a repeat of the same command with the same arguments over a tree nothing has
  touched since buys only a copy of the answer already in hand (joshuafolkken/kit#1383).
- **The pull request opens between the rounds, so CI runs beside round 2** — `pnpm josh git -y` sits
  between the two review rounds. Round 1 runs on the uncommitted tree and its High/Medium findings are
  fixed before anything is committed; the verification pass over those fixes then runs against the open
  pull request, beside the CI the commit started (joshuafolkken/kit#1261).
- **The round-2 fix commit is pushed before its gate** — a fix the second round makes in place is
  pushed (`pnpm josh git -y` again, a follow-up commit) before its `pnpm josh gate`, so the gate runs
  inside the CI wait and is joined before `pnpm josh followup` rather than in front of it
  (joshuafolkken/kit#1326). The commit and pre-push hooks and CI's `Checks` job mean pushing first is
  not pushing unverified code.
- **A clean second round issues the merge in the same turn** — the turn that reads a clean second round
  issues `pnpm josh followup`, after any branch-2 filing and `pnpm josh epic:bundle` and never in a turn
  of its own. Clean has two halves: no confirmed High is standing, and nothing was routed to branch 1 of
  the disposition (joshuafolkken/kit#1333).
- **The review runs in a subagent, never a main-line skill load** — `/code-review` is spawned through
  the `Agent` tool in its own context, as the agent type step 1 names; a mid-run `Skill` load rewrites
  the whole cached prompt prefix, which is what makes it expensive (joshuafolkken/kit#1855).
- **The brief names the checkout, and a review that read another one is refused** — `pnpm josh
  review:brief` prints the checkout root, branch and HEAD and a nonce; the review runs `pnpm josh
  review:attest <nonce>` from the tree it read, and `pnpm josh review:attest --check` must answer `ok`
  before the run or `pnpm josh followup` acts on the verdict, or it is discarded (joshuafolkken/kit#1522).

This file is the single source of the gate → review → PR → merge chain rule; other documents reference
it rather than restating it. `prompts/collaboration-workflow/plan-comment.md` keeps Step 3.
