# Review-to-merge chain rule — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/chain-rule.md`: where each
step and orchestration fact came from, and the reasons behind them. It is never read during a run —
every rule, step and refusal an agent acts on stays in the procedure document, and a change to this
file changes no rule.

## Where each rule came from

- The lane child's single `pnpm josh ship --detach` hand-off (step 0) — joshuafolkken/kit#2428.
- The Anthropic lane's stop prompt naming the re-detach to run after the fix — joshuafolkken/kit#2964.
- A backgrounded `ship` issued alone being moved to the foreground by the hook rather than refused —
  joshuafolkken/kit#3154.
- The pre-gate cut `pnpm josh run:cut <N>` — joshuafolkken/kit#2177.
- `pnpm josh run:review` starting the gate and printing the brief in one call — joshuafolkken/kit#2179.
- Naming the review subagent's agent type (a guessed type name fails) — joshuafolkken/kit#2297.
- `followup` refusing the merge until the review round is recorded — joshuafolkken/kit#2343.
- The clean path's single `pnpm josh ship` call — joshuafolkken/kit#2398; its PR preflight —
  joshuafolkken/kit#2946; `--review` running both rounds — joshuafolkken/kit#2489.
- The orchestration facts moving here out of `prompts/review.md`, which kept only the review policy
  (level, round cap, disposition) while `prompts/review-rubric.md` took the rubric —
  joshuafolkken/kit#1927.
- The gate running beside the review — joshuafolkken/kit#1242.
- origin/main merged in before the gate — joshuafolkken/kit#1837; the conflicted-merge procedure
  written once here — joshuafolkken/kit#2445.
- A single check answering once per tree — joshuafolkken/kit#1383.
- The pull request opening between the rounds — joshuafolkken/kit#1261.
- The round-2 fix commit pushed before its gate — joshuafolkken/kit#1326.
- A clean second round issuing the merge in the same turn — joshuafolkken/kit#1333.
- The review running in a subagent — joshuafolkken/kit#1855.
- The brief naming the checkout and the attest check — joshuafolkken/kit#1522.

The measurements that motivated each fact live in the Issues above.

## Why the orchestration facts hold

- **Gate beside the review.** The gate and the review read the same tree and neither writes to it, so
  running them serially is pure waiting.
- **origin/main merged before the gate.** The gate then verifies the tree that will actually merge
  rather than one that never existed. A stash reapplied over the merge leaves `UU` in the index, which
  is why the procedure never stashes around it.
- **Round-2 fix pushed before its gate.** The commit and pre-push hooks and CI's `Checks` job mean
  pushing first is not pushing unverified code, and the gate then runs inside the CI wait.
- **Review in a subagent.** A mid-run `Skill` load rewrites the whole cached prompt prefix, which is
  what makes a main-line review load expensive.
