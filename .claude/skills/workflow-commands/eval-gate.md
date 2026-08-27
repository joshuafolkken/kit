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

## Where it sits

**After `/code-review` has converged, before `pnpm josh bump minor`. Never inside `pnpm josh gate`.**
Two reasons, each sufficient: the gate re-runs on every fix round and on every `epicrun` child, and
one `josh eval` is five real Claude sessions; and the review rewrites the very prose being measured,
so measuring before it converges measures a draft.

`halfrun` reaches the same point — the measurement runs inside its gate, before the stop.

## What a result does

The run's last line is the verdict, because the exit code cannot carry this: it is `0` only when
every scenario passed, so a failed run and one that measured nothing exit alike.

| Verdict      | Meaning                                     | The merge                                                                    |
| ------------ | ------------------------------------------- | ---------------------------------------------------------------------------- |
| `held`       | every scenario held                         | continue                                                                     |
| `blocked`    | a scenario failed — a measured violation    | **stop** — fix the prose its `→` line names, re-run that scenario by name     |
| `unmeasured` | a scenario produced no measurement (`?`)    | continue, and say so in the completion report                                 |

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
