# The rule-compliance measurement — when `josh eval` runs

`josh eval` (joshuafolkken/kit#855) measures whether a change to the distributed documents, skills or
hooks actually changed what an agent does, by judging real sessions on their **tool calls**. Until
joshuafolkken/kit#907 nothing said *when* to spend it, so a pull request that rewrote one rule and
regressed another had no detection path. This file is that definition. The canonical extended
reference is `prompts/collaboration-workflow/eval-gate.md`.

## Ask the command; do not decide

```bash
pnpm josh eval:scope   # → required | skip ; the reason on stderr
```

The branch diff is what the gate asks about. `--staged` exists for a pre-commit reading, and there
the empty-list rule below bites: an empty index answers `required`, which here costs five real
sessions rather than `review:level`'s free `medium`.

**The input is the set of changed paths and nothing else.** "This edit is only wording" is a
judgement made under cost pressure, and cost pressure resolves it toward `skip` exactly when a
regression is most likely to ship — the same reason `pnpm josh review:level` took the review level
out of an agent's hands.

The trigger set is derived from what the eval sandbox copies, not restated: `CLAUDE.md`,
`AGENTS.md`, `GEMINI.md`, `.claude/skills/**`, `prompts/**`, `.claude/settings.json`.

- **One measured path decides the whole change.** The suite measures the distribution, not the file
  that changed, so running it for part of a diff is not a thing that exists.
- **An empty path list answers `required`.** `skip` there would hand a caller that failed to read the
  diff the same answer as one that measured.
- **The harness and the scenarios themselves (`scripts/eval/**`, `evals/scenarios/**`) do not fire
  it.** Changing the ruler is not changing what it measures.
- **One entry is coarser than what the suite can see: `.claude/settings.json`.** The sandbox copies it
  through a filter that drops every hook running `pnpm` / `npm` / `yarn` / `npx` / `josh`, since those
  die in a directory with no `package.json` (`docs/eval.md` → "Where a run happens"). A change to only
  such a hook still answers `required`, and no scenario can observe it — say that in the report rather
  than reading the run as a measurement of the hook. Narrowing the trigger instead would mean parsing
  the diff, which is the judgement this command exists to remove.

## Where it sits — started with the review, read after it

**Start `pnpm josh eval` in the background when `/code-review` starts, and read its verdict once the
review has converged — before `pnpm josh bump minor`, and never inside `pnpm josh gate`.** Two
reasons keep it out of the gate, each sufficient: the gate re-runs on every fix round and on every
`epicrun` child, and one `josh eval` is five real Claude sessions; and the review rewrites the very
prose being measured, so a verdict *read* before the review converges is a verdict about a draft.

**The two overlap because neither writes.** `/code-review` and `josh eval` both only read the working
tree — a review's fixes are applied after it reports — so the suite's wall-clock hides inside the
review's instead of following it (joshuafolkken/kit#1152). Measured on the loop this shipped in,
`josh eval` was the longest remaining serial stretch of the gate: `pnpm josh gate` is 17s and already
concurrent, CI is 95–120s and already parallel, and the suite alone runs 100s and up.

**What the overlap costs is certainty, and that is bought back mechanically.** `josh eval` measures
the documents as they stood when it started. If the review then edited a measured path, the verdict
describes a tree that no longer exists — **a stale result is never reported**. Ask, once the review
has converged:

```bash
pnpm josh eval:scope --since-eval   # → required | skip ; the reason on stderr
```

| Answer     | What it means                                                                             | What to do                                           |
| ---------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `skip`     | the review changed nothing the scenarios can see                                          | the concurrent verdict stands — read it and go on    |
| `required` | the review edited a measured path, **or there is no record of what a run measured**       | run `pnpm josh eval` again and read *that* verdict    |

**The question is asked of the review's own diff, not the branch's.** `josh eval` writes the record
before its first session, so the comparison is against exactly the tree those scenarios read; the
reason line names when it was taken, which is how a record left by some other loop shows itself. The
plain `pnpm josh eval:scope` still asks about the branch — the two are different questions, and
`--staged` alongside `--since-eval` is refused rather than resolved. **Only a whole-suite run writes
the record**, so the named re-runs a `blocked` verdict asks for below leave it alone rather than
letting one scenario stand in for the suite.

**The common answer is `skip`.** A review that lands no high/medium finding changes nothing at all,
and that is the case this placement is for.

**Only *when* the measurement is taken changes; what a verdict does does not.** `blocked` still stops
the merge and is still attributed before it does, `unmeasured` still does not block and is still
reported, and the verdict is still the run's last line rather than its exit code. The rule that
outranks the saving is unchanged too: **never report as green a run you did not see hold** — a
concurrent run's output is read in full before its verdict is treated as an answer.

A serial run remains correct, only slower: starting the suite after the review has converged and
skipping the `--since-eval` question measures the same tree.

`halfrun` reaches the same point — the measurement runs inside its gate, before the stop.

## What a result does

The run's last line is the verdict, because the exit code cannot carry this: it is `0` only when
every scenario passed, so a failed run and one that measured nothing exit alike.

| Verdict      | Meaning                                     | The merge                                                                    |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `held`       | every scenario held                         | continue                                                                     |
| `blocked`    | a scenario failed — a measured violation    | **stop** — fix the prose its `→` line names, re-run that scenario by name     |
| `unmeasured` | a scenario produced no measurement (`?`)    | continue, and say so in the completion report                                 |

- **A red scenario is confirmed on the same tree before a pair is formed.** One scenario is one real
  Claude session, so its verdict is a sample rather than a fact: measured on joshuafolkken/kit#1071,
  `no-implicit-workflow` failed 2 of 10 readings of an **unchanged** tree. Reading each side once
  therefore manufactures `held → failed` about one time in six on its own, which is what
  stopped the merge on joshuafolkken/kit#1062 — the same tree read twice, disagreeing with
  itself. Re-run the failing scenario alone, against the tree that just failed:

  ```bash
  pnpm josh eval <name>          # the same tree, a second reading
  ```

  | The second reading | What it is |
  | --- | --- |
  | failed again | The failure belongs to this tree. Take the baseline below and attribute it |
  | held | **The scenario disagreed with itself on one tree**, so there is nothing to attribute and no baseline to take. Record both readings on the Issue in hand, file the instability as its own Issue against that scenario (Tier A, first-party) unless one is already open, and continue |
  | measured nothing (`?`) | No confirmation either way. Re-read once more; if it still will not measure, report the whole run as `unmeasured` and neither block nor attribute — the same answer the baseline table's `inconclusive` row gives |

  **What this trades, stated plainly — and it is not uniformly favorable.** A rule that stopped
  working outright fails both readings and stops the merge exactly as before. A rule that only
  *sometimes* fires can pass the second reading and merge: one failing 7 readings in 10 gets through
  about 3 times in 10, which is *larger* than the one-in-six false block being removed. So this buys
  a reliable gate rather than a strictly stronger one, and it is taken for a reason about behavior
  rather than about probability — **a gate that stops merges at random is one that runs learn to
  argue with**, and the next real failure is then attributed away with the reasoning the false ones
  taught. **The disagreement is what keeps the trade honest**: it is recorded on the Issue in hand
  and filed against the scenario, so a rule failing half its readings surfaces as a ruler nobody can
  read rather than as silence. It costs one extra session only when a scenario is red, and where the
  red was noise it *replaces* the baseline session rather than adding to it.
- **A `blocked` verdict is attributed before it blocks.** The suite measures the whole distribution,
  not the diff, so a scenario can be red for something that predates the change — and `docs/eval.md`
  already makes the unit a **pair** of readings, before and after. Take the second one, for that one
  scenario only:

  ```bash
  git stash push -u -m "eval baseline"
  pnpm josh eval <name>          # the pre-change documents
  git stash pop
  ```

  | Before | After | What it is |
  | --- | --- | --- |
  | held | failed | **This change regressed it.** Fix the prose the `→` line names and re-run that scenario. **At most two rounds**, for the reason `prompts/review.md` caps review rounds — each fix makes new surface, and an uncapped loop does not terminate. Still red after the second: park the child with `needs-decision` inside an `epicrun`, otherwise send a `confirmation` Telegram and stop |
  | failed | failed | **A standing failure, not this change's.** File it as its own Issue (Tier A, first-party), record both readings on the Issue in hand, and continue. Blocking here would freeze every distributed-document change behind a defect none of them introduced |
  | inconclusive | either | No pair, so no attribution. Re-run the baseline once; if it will not measure, treat the whole thing as `unmeasured` and report it |

  **Never skip the baseline and call a red scenario pre-existing.** That is the judgement this command
  exists to remove, pointing the other way.
- **A run the suite could not act on says `blocked`, not `unmeasured`** — a mistyped scenario name in
  the re-run above is the case. You asked for a measurement and have none, and `unmeasured` would let
  it through.
- **The exit code is not the answer; the verdict line is.** `josh eval` exits non-zero for an
  `unmeasured` run exactly as for a `blocked` one, so never chain it (`josh eval && …`) or put it
  behind `set -e` — that turns an upstream budget outage into a stopped run, which is the outcome
  this rule exists to avoid.
- **`unmeasured` says nothing about the rules.** `docs/eval.md`: a run of inconclusive verdicts is a
  statement about the shared upstream budget. It does not block the merge — blocking on it would park
  work for an outage. **It is still reported** — and a run that printed no verdict line at all (no `claude` CLI, an expired
  login) is `unmeasured` too. **Never report as green a run you did not see hold.**

## In a consumer project, the suite measures the installed kit

The trigger reads **this** repository's changed paths; the sandbox copies the documents from the
installed `@joshuafolkken/kit`. In kit itself those are one tree. In a consumer they are not: a
commit of a `josh sync` answers `required`, and what then gets measured is the distribution that sync
just installed — which is the right thing to measure there, since a consumer never edits a
distributed document locally (`CLAUDE.md` → "Route distributed-doc / config changes upstream to
kit"). **A red scenario in a consumer is therefore an upstream Issue in kit, never a local fix.** A
consumer's own project-local skill is outside what the suite can see at all, and `required` there
buys nothing — say so in the report rather than reading the run as a measurement of it.

## The cost ceiling

**Every scenario, once per Issue.** Not "the scenarios related to the change": a scenario declares
the *rule* it measures, never the *file* the agent will read, so selecting by path would need a
per-scenario declaration that is itself a guess — and `docs/eval.md` makes `n/m` the unit of
comparison, which a subset cannot be compared against. The ceiling is on how often, not how many, and
the single placement after `/code-review` is that ceiling.

## An epic's completion does not run it again

`epicrun` reaching `complete` posts the epic summary and does **not** re-run the suite. The reason is
not cost: because every child that touched the distribution ran **all** the scenarios and blocked on
a failure, the gradual degradation an epic-completion run would look for has already been measured —
at the end of an epic the tree is the one the last document-touching child measured. A second
measurement of the same state is what would be bought, at the price of a baseline stored across
sessions, which `epicrun` keeps nowhere but GitHub. Full reasoning, and the answer to "an unattended
run has no other instrument": `prompts/collaboration-workflow/eval-gate.md`.
