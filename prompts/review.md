# Code Review Prompt

This document is the **single source of truth** for reviewing a diff. The implementing session runs it inline, before committing — both for the pre-commit self-review and for the review step inside `fullrun` / `halfrun` / `queue`, whose **second** round is the one exception: it runs beside CI on a pull request the first round's fixes have already opened (see "The pull request opens between the rounds").

**Default hypothesis: this diff contains at least one non-trivial issue.** Your job is not to confirm the implementation is correct — it is to find the issue. Work through each category assuming the code is wrong until you can prove otherwise. Do not declare a category clean unless you have actively tried to break it.

**In the second round that hypothesis is aimed at the fix delta, not at the whole diff again.** Applied twice to one diff it returns new findings whether or not the code changed, because returning none is what it rules out — see "The second round is a verification pass, not a second full review" below.

---

## When to run

- **Pre-commit self-review** (implementing session, inline): before every `git commit` on a feature branch — scope: the staged diff (`git diff --staged`)
- **Workflow review step** (same session, inline): the last stage of the verification gate in `fullrun` / `halfrun` / `queue`. Round 1 runs before `pnpm josh bump minor` and the commit — scope: `git diff main`. Round 2 runs after them, beside the CI the commit started, scoped to the fix delta ("The pull request opens between the rounds")

Re-run after applying fixes until **no high or medium findings remain — or until two reviews have run in total — the first one included — whichever comes first.** Low findings may be acknowledged and skipped with a reason. The cap is spelled out below and it is not optional.

**The re-run is not this review a second time.** The second round is a **verification pass over the fixes** — its scope, its question, its categories and its output all differ from the first round's. Definition: "The second round is a verification pass, not a second full review" below.

---

## Review level (decided by `josh review:level`, never by judgement)

**Run `pnpm josh review:level` and use what it prints.** It reads the changed paths and answers `low` or `medium`; `--staged` classifies the staged diff instead of the branch diff, and `--json` adds the reason.

```bash
pnpm josh review:level            # alias: josh rl
pnpm josh review:level --staged
```

**Inside a workflow, run `pnpm josh review:brief` instead and pass the whole thing to `/code-review`.** It prints the level on its first line and then the rest of what the run already knows: whether `pnpm josh gate` has passed — or is running right now — **on this exact tree**, how this project runs its unit suite, and the target — the whole change on round 1, and on `--round 2` only the files the first round's fixes touched.

```bash
pnpm josh review:brief            # round 1; alias: josh rb
pnpm josh review:brief --round 2  # the verification pass, scoped to the fix delta
```

**It exists because `/code-review` runs in a forked process that reads none of this repository's documents** (joshuafolkken/kit#1241). Only the invocation argument reaches it, so a rule written here — "do not re-run what the gate proved", "the second round reads the fix delta" — has no way to bind. Measured on joshuafolkken/kit#1240: both rounds re-ran the unit suite the gate had just passed, both fumbled the runner, and round 2 re-read the whole diff, for 439 seconds on a seven-file change.

**Two halves, and only one of them is mechanical.** The round-2 target _is_ the scope, so a narrowed round is narrowed whatever the agent decides. The "already verified" block is an instruction to an agent that has a shell, so its effect is measured rather than assumed. **The brief never claims a green gate it cannot prove**: with no record, or with one taken before an edit, it prints `Not verified` and asserts nothing.

### The gate runs beside this review, not in front of it

**`pnpm josh gate` is started when the review starts and joined before the commit** (joshuafolkken/kit#1242). The two read the same tree and neither writes to it, so running them one after the other was pure waiting — 187 seconds of a 1623-second run, measured on joshuafolkken/kit#1240. It is the treatment `josh eval` already gets, for the same stated reason.

**So the brief has three states, not two**, and the middle one is the usual answer while a review is being composed:

| The record says                           | The brief prints   | What it means                                                                                 |
| ----------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------- |
| A green gate covers this exact tree       | `Already verified` | Lint, the type check, the spell check and the unit tests passed. Do not re-run them           |
| A gate is running against this exact tree | `Running now`      | **No result is being claimed.** Do not re-run the unit suite; the run joins the gate's result |
| Neither                                   | `Not verified`     | Nothing is claimed about any of the four checks                                               |

**`Running now` forbids a re-run without asserting a pass, and the distinction is the whole point.** A gate that has not finished has no result to report, so the sentence says what is true — a gate was started on this tree at a named time and has not recorded a result — and names who reads that result. Re-running the unit suite here is wasted whether the gate ends green or red.

**Joining is a step of the run, not a formality.** A red gate is fixed and re-run **whatever this review concluded** — a clean review says nothing about lint or the unit tests — and the fix is uncommitted like every other, so it lands in the round-2 fix delta and is reviewed with the rest. There is no path from here to a commit on a gate nobody read.

**The gate is started once per run, not once per edit** (joshuafolkken/kit#1246). joshuafolkken/kit#1242 decided _when_ the one gate starts and left _how many_ there are untouched, and the count is the larger half: measured on joshuafolkken/kit#1241, ten gate runs came to 8.2 minutes of a 49.1-minute run — a 49-second average — second only to the two review rounds. Six of the ten ran before the review had started, each asking whether the edit just made had broken anything, and in every one of those six the answer came from a single check: lint or the spell check, while the other three checks in the same gate ran to completion with nothing to report. One check costs 4 to 17 seconds. (A standalone gate on an otherwise idle machine is faster than the average a run pays — 31 seconds measured here, and the 17 seconds `eval-gate.md` records. The figure to reason about is what the run was billed.)

**Which command to run is decided by whether the review has started, and by nothing else.** "This edit is big enough to warrant the whole gate" is the judgement under cost pressure the level rule below refuses to allow, and it resolves the same way — toward the expensive habit, on every edit.

| Where the run is                                             | What to run                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implementing — the review has not started                    | **The single check by name** — `pnpm josh lint`, `pnpm josh cspell:dot`, `pnpm josh test:related`, or the project's own type check. Never the whole gate. (Once a gate _has_ run, its block header names each command, including the type check's, which is resolved per project) |
| The edit set is complete and the review is starting          | `pnpm josh gate`, started beside the review — the one gate the commit is decided on                                                                                                                                                                                               |
| From there on, a check that gate reported red has been fixed | `pnpm josh gate` again. The fix is what made the previous result stale, which is the rule above                                                                                                                                                                                   |
| The edit set is final and the commit is next                 | `pnpm josh bump minor` **first**, then `pnpm josh gate` again — that one covers the exact tree the commit carries, and it is joined before `pnpm josh git -y` ("The pull request opens between the rounds" below)                                                                 |
| Round 2 fixed a finding in place                             | `pnpm josh gate` again, joined before the follow-up commit. **There is still no path to a commit on a gate nobody read**, and a red check caught here costs seconds where the CI it would otherwise reach costs a whole cycle                                                     |
| Round 2 changed no code                                      | Nothing local. The head commit already rests on a joined gate, and CI has been running on it since the pull request opened                                                                                                                                                        |

**The unit check in the first row is the scoped one** (joshuafolkken/kit#1257). `pnpm josh test:related` runs only the tests whose module graph reaches a changed file — 566 of 6,616 tests for a one-file change, 2.4s against 13.9s, and 7.9s of CPU against 110s — and falls back to the whole suite, saying so, when it cannot narrow. `pnpm josh test:unit` is unchanged as what `pnpm josh gate` runs and what the commit rests on: a marker suite that reads a document breaks without importing anything, so a module graph cannot see it and the scoped run is added in front of the full one rather than in place of it.

**The criterion is the review, not the tree.** Once the gate has been started beside the review, every later edit — a red check's fix, a round-1 finding's fix — changes the tree and makes the last result stale, so every row below the second governs from there and a single check no longer answers for the commit. Reading the criterion as "no gate has run on _this exact_ tree" would send a run back to row 1 after every fix, which is the opposite of what the rows say.

**Nothing here weakens the join**, and the first row is the only one that removes work. The gate the commit rests on is still one started beside the review and joined before the commit; what the first row removes is the probing in front of it, which proves nothing the join does not prove again a few minutes later.

**The level is decided from the changed paths and nothing else.** "This one is small" is a judgement made under cost pressure, and cost pressure resolves it toward "small" exactly when a defect is most likely to be shipped — the same reason the cross-package interrupt removed its own "does this block?" evaluation. A rule an agent applies from memory is a rule an agent can talk itself out of; one it has to run answers the same way every time.

| Every changed path is…                                                                   | Level    | Rounds                  |
| ---------------------------------------------------------------------------------------- | -------- | ----------------------- |
| **inert** — `.editorconfig`, `.gitignore`, `LICENSE`, `CHANGELOG.md`, `*.code-workspace` | `low`    | 1                       |
| anything else                                                                            | `medium` | up to 2 (the cap below) |

**One non-inert path decides the whole change.** A review reads the change, not a subset of it, so there is no per-file level. An empty diff also takes `medium` — answering `low` to "nothing changed" would hand a reduced level to a caller that failed to read the diff.

**Three things that look inert are not.** `.vscode/**`, `.gitattributes` and `.prettierignore` are all in `package.json`'s `files` and are written into every consumer project by `josh init` / `josh sync`, so a defect in one reaches a consumer and is reviewed at `medium` like any other shipped file.

**Documentation is not inert either, and that is deliberate.** `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` are all reviewed at `medium`. The "Non-runtime updates" exception in `CLAUDE.md` exempts them from _testing_, which is a different question: that exception asks whether an automated test could have caught the defect, and this asks whether a human reading the diff is the only thing that can. Measured on joshuafolkken/kit#963 and #965 — both documentation-only by that classification — a `medium` review found ten real defects in each: pointers into sections that had been removed, and citations naming the wrong file, in artifacts distributed to every consumer. Nothing else would have caught them.

**The round cap below is unchanged**, and so is the rule that a confirmed High blocks regardless of round count.

### The pull request opens between the rounds, so CI runs beside round 2

**`pnpm josh bump minor` and `pnpm josh git -y` sit between the two review rounds** (joshuafolkken/kit#1261). Measured on joshuafolkken/kit#1251: the second round ran 171 seconds and the CI that followed it ran 98, and through those 98 seconds nothing else in the run was happening. The same reasoning the gate got one section up applies here — the pull request's checks and the verification pass read the same branch, so paying for them one after the other was pure waiting.

**Only the second round moves, and that is what makes the overlap safe.** The first round still runs on the uncommitted tree and every High/Medium it finds is fixed before anything is committed, so the first commit still carries reviewed code — the requirement `CLAUDE.md` → "Pre-commit Self-Review" states. What changes is that the verification pass over those fixes now runs against an open pull request instead of in front of one.

| Where the run is                 | What happens                                                                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Round 1 found no High/Medium     | Nothing changes. There is no second round, and the commit follows the join exactly as it always did — a red check fixed on the way still re-runs the gate, per the table above, which is a different trigger from this one |
| Round 1's fixes are in           | `pnpm josh bump minor` → `pnpm josh gate` → join → `pnpm josh git -y`. The pull request opens here and CI starts                                                                                                           |
| Round 2 is running               | CI is running beside it. Its brief reads `Already verified`, because the gate above covered the bumped tree                                                                                                                |
| Round 2 fixed a finding in place | `pnpm josh gate`, joined, then `pnpm josh git -y` again — a follow-up commit on the same branch, **no second `bump`**, and CI re-runs on it                                                                                |
| Round 2 only filed or dropped    | Nothing more to commit; the CI already running is the one the merge rests on                                                                                                                                               |

**The bump goes in front of that gate, not after it.** `pnpm josh bump minor` edits `package.json`, and the gate's record is keyed to the exact tree it read — so a gate taken before the bump reads as `Not verified` to round 2's brief, and the round-2 agent re-runs the unit suite the gate had just passed, which is more than the overlap saves. Running the bump first costs nothing, because that gate run is the one round 1's fixes already required, and it leaves the commit resting on a gate that covered the version bump too — which the old order never did.

**`package.json` therefore appears in round 2's target**, since the fix delta is every path whose digest moved since round 1. That is expected rather than an error, and it is not worth excluding: deciding mechanically that a `package.json` edit is never a fix would hide a round-1 fix that genuinely edits it from the pass whose whole job is to verify that fix.

**The merge gate is untouched.** `pnpm josh followup --merge` blocks on the head commit's checks, so a follow-up commit's CI is what the merge rests on, and every merge condition — all required checks green, no standing change request — is the one it was. A confirmed High found in round 2 still stops the run with a `confirmation` Telegram; the only difference is that the pull request exists and stays open and unmerged rather than never having been opened.

**What this trades is a CI run for wall-clock, and the trade was made deliberately.** A second round that fixes something in place costs one extra commit and one extra CI run, and in exactly that case the overlap is paid straight back. Since joshuafolkken/kit#1219 the second round reads only the fix delta and asks whether each finding closed, so its usual result is no code change at all, and that is the case the overlap is bought for.

**This is the narrowed form of what joshuafolkken/kit#1216 rejected, and the narrowing is what its objection asked for.** That issue rejected opening the pull request before the review on a mechanism rather than a rule: the review changes code, so every fix pushed afterwards restarts CI and pays the overlap back. The round that changes code — the first — still runs before the commit.

## Severity (decided by a test, never by discretion)

The output format below demands a severity on every finding, and for a long time nothing said what earns one. `medium` is a blocker — it must be fixed before the PR is opened — so a borderline finding rated `medium` costs a whole round, and whether it got one was left to whoever happened to be reviewing (joshuafolkken/kit#1220).

**A finding is `medium` or higher only when both of these hold:**

1. **It reaches something real** — a runtime code path, a distributed artifact a consumer reads, **or the verification that guards either**: a test, fixture or CI check whose defect lets one of the first two ship unnoticed. The third member is not decoration. `package.json` excludes `**/*.test.ts` and `**/*-fixture.ts` from what it ships, so without it a vacuous or wrongly-pinned suite — the failure mode this repository's marker suites exist to prevent — could never exceed `low` and would always be skippable in one line.
2. **You can write the concrete failure scenario** — the inputs or state, and the wrong output, breakage or misreading that follows. Not "this could be confusing": the actual sequence.

**Fail either test and the finding is `low`.** In particular, **a finding whose failure scenario you cannot write is `low` however uncomfortable it looks** — that is the whole of the second test, and it is the one that decides borderline cases.

**Test 2 asks whether a scenario can be written, not whether you wrote one.** The cheap action — not attempting it — produces the non-blocking severity, which is the same cost-pressure inversion the level rule one section up exists to remove, and it is the one place this test is weaker than a command you run. So the obligation is to **attempt the scenario for every finding that passes test 1, and to say so when the attempt failed**: "no failure scenario — <what you tried>" is the evidence, and a `low` on a test-1 finding without it is not a severity, it is a skipped step.

**A distributed artifact is on that list deliberately.** "Documentation is not inert either" above already reviews `CLAUDE.md`, `prompts/**`, `.claude/**` and `docs/**` at `medium`, on the measurement that joshuafolkken/kit#963 and #965 each carried ten real defects reaching every consumer with no test in front of them. A severity rule that ranked documentation below runtime code would contradict the level rule one section up.

**This is the same move `josh review:level` made, one level down.** A rule an agent applies from memory is a rule an agent can talk itself out of, and a severity nobody defined is a severity that drifts upward under an instruction to find something. Measured, not theorized: rounds three and four of joshuafolkken/kit#854 were spent on a misplaced comment, an unused export and a stale comment — findings the Low rule already permitted skipping, treated as blockers because they came back without severities.

**Test 2 is not a new demand.** Category 1 already requires an explicit trace — `Traced [input/state] → [result]` — and the failure scenario is that same sentence. What changes is that a finding without one no longer carries a blocking severity.

**`high` and `low` are unchanged.** A `high` is fixed before committing and blocks the merge regardless of round count; a `low` that does not reach the user may be skipped with a one-line reason. This section decides which findings reach `medium`, not what a severity then does — with the one clarification below, which the second way of becoming a `low` makes necessary.

**It agrees with the three-way disposition below.** Branch 2 files a finding that "reaches a runtime code path, or it needs a decision", and that phrase is read with the same extension as test 1 here — a distributed artifact, and the verification guarding either, both count as reaching one.

**A `low` is not automatically droppable, and the two ways of becoming one are why.** Branch 3 drops "a Low finding that does not reach the user" — that is **test 1** failing, and only that. **A finding that passed test 1 and was rated `low` for want of a failure scenario still reaches the user**, so it is not branch 3's: it goes to branch 1 when it closes in a few lines inside a file the diff already touches, and to branch 2 otherwise. Reading every `low` as droppable is what would let the cheaper severity double as the cheaper disposition, which is the drift this section exists to stop.

## Review round cap (2 rounds)

The severity rule above is not a stopping condition on its own. Every fix creates new surface, and a review whose scope is the whole change finds something in it — so the loop is bounded by how much new code the fixes produce, which is unbounded.

This is measured, not theorized. On joshuafolkken/kit#854 four rounds produced 18 findings; on joshuafolkken/kit#855 two rounds produced 19. Almost none of them was a repeat: each round found new things, and many of those were about code the **previous round's fix** had just written. One fix replaced a line-based check with a proximity window, and the next two rounds each found a new defect in that window. Another moved a rule into a skill, and a later round moved it back. Two rounds of that is diligence; a third is the review chasing its own tail.

### The second round is a verification pass, not a second full review

**The second round asks a different question from the first.** Until joshuafolkken/kit#1219 it asked the same one — read the whole diff adversarially — inside a document whose opening line forbids declaring anything clean without proof. Read one diff twice under that instruction and the two readings return different findings whether or not the code changed, because returning none is what the instruction rules out. So a Medium stood at the second round even where the fixes were sufficient, and the three-way disposition below had to be run every single time.

**What changes is the question, never the standard.** A confirmed High still blocks the merge whatever the round count, the cap is still two rounds, and every rule below applies to this pass unchanged.

|                | The first round                    | The second round                                                                                                                                                               |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Scope**      | `git diff main` — the whole change | the **fix delta**: what the first round's fixes wrote, plus the call sites of any signature they changed                                                                       |
| **Question**   | "review this change"               | "did each first-round finding actually close, and did the fix itself introduce a defect?"                                                                                      |
| **Categories** | all nine                           | category 1 (Bug risks & logic errors), plus the categories the fix delta actually touches — i18n only if a fix added a user-visible string, Tests only if a fix changed a test |
| **Output**     | the full template                  | one line per first-round finding with its resolution, then any new finding **inside the fix delta**                                                                            |

Template for the second round:

```md
### First-round findings

1. `src/foo.ts:42` (was high) — resolved — <how the fix closes it>
2. `src/bar.ts:8` (was medium) — **not resolved** (medium) — <what still stands>

### New findings in the fix delta

- `src/foo.ts:47` (medium) — <problem> — <fix>

### Summary

<counts by severity across both sections, and overall go/no-go>
```

**A first-round finding the fix did not close is still a finding, at its original severity.** The pass narrows what is read, not what counts — an unresolved High blocks exactly as it did in the first round.

**This is a generalization of a rule already written, not a relaxation of one.** Branch 1 of the three-way disposition below already states that **a fix-in-place never starts a new review round** — so the document has already accepted that a fix does not oblige anyone to read the whole diff again. The second round applies that same reasoning to the rest of the fixes: what has to be read is what the fix wrote, and re-reading the code no fix touched is what manufactures the artificial findings above.

**It converges because the fix delta shrinks.** Each round's fixes are smaller than the last, so the scope is monotonically decreasing — which the whole-diff scope never was, and which is why the cap had to bound the loop from outside rather than the loop ending on its own.

### Three-way disposition after the cap

**The cap needed three exits, not one.** For a long time it had exactly one: after the second round, every non-High finding was filed as a follow-up Issue. That is the largest single manufacturing line of follow-up Issues in this workflow, and it files Issues that are not worth one — joshuafolkken/kit#1069 corrected three comments that changed no executable line and still took six Issues across two REST-migration cleanups to do it, each carried over because a per-child scope check dropped it. **A finding's disposition is decided from what it is, mechanically — not from the filer's discretion.** After the second round, place every remaining non-High finding in exactly one of these:

1. **Fix it in place.** The finding closes in a few lines inside a file the diff already touches, with no design judgement — a stale comment, a name, an unused export. **A fix-in-place never starts a new review round.** This is the ceiling that keeps the exit from buying back the round cap: the fix widens the diff, so a naive re-review would find it and re-open the loop the cap just closed. The bound is written into the exit itself — the fix must stay **inside a file the diff already changed** and carry **no design decision**; a finding that cannot close under both limits is not a fix-in-place, it is filed.
2. **File it as an Issue.** The finding reaches a runtime code path, or it needs a decision. This is the branch the old blanket rule collapsed everything into, and the filing procedure below — reference the current Issue, then bundle — is unchanged for it.
3. **Drop it with a one-line note in the PR body.** A Low finding that does not reach the user — that is, one that failed test 1 of "Severity" above, and **only** that one. A `low` rated for want of a failure scenario passed test 1 and does reach the user, so it takes branch 1 or branch 2 instead. This is the same disposition the pre-commit self-review already permits for a Low ("Low findings that do not reach the user may be skipped with a one-line reason"), extended past the round cap — the two documents no longer disagree about what happens to a Low.

**Findings that reduce to one root judgement are filed as one Issue, not several.** When two or more findings are the same underlying design decision seen from different call sites, they belong in a single follow-up Issue with a section per symptom (`## 現象 1` / `## 現象 2`), the shape joshuafolkken/kit#1077, #1068 and #1069 already use. Deciding this from the findings rather than the filer's discretion is the point: without the rule, whether they collapse is left to whoever happens to be filing.

Only branch 2 files an Issue. What follows applies to that branch.

- **A finding routed to branch 2 is filed as a follow-up Issue, and the current Issue completes.** Filing is mandatory for that branch — a finding that reaches a runtime path or needs a decision is never silently dropped — and the new Issue references the current one. (A confirmed High is not a branch-2 finding: it blocks the merge rather than being deferred — see below.)
- **Filing does not end at the Issue.** `epic:next` only ever offers a child an epic's task list names, so an Issue in no epic is never handed to a running `epicrun` — picking it up takes a person who already knows its number. The deferred finding is not dropped, it is parked forever, which reads the same from the backlog. The step belongs here rather than only in the epic rules, because a procedure that ends at "file it" is followed to its end:

  **The three steps run inside the CI wait, not before the commit.** Where the run opens a pull request — `fullrun`, `queue`, `epicrun` — they go after `pnpm josh git -y` and before `pnpm josh followup --merge`. Where it does not — `halfrun`, or a standalone pre-commit self-review — they run as soon as the disposition is decided, because there is no CI to hide behind. **The deadline is unchanged**: the current Issue closes when the pull request merges and `followup` is what merges it, so every step still runs while the parent is open, which is all step 2 requires. What moves is only whose seconds they are. Measured: `epic:bundle` 43s and `epic --add` 18s on joshuafolkken/kit#1229, against the 78 seconds joshuafolkken/kit#1238 spent waiting on CI with nothing else to do (joshuafolkken/kit#1239).

  **This is not "review during CI", which was decided against.** joshuafolkken/kit#1216 rejected opening the pull request before the **first** review round, and the reason is not a rule but a mechanism: that would overlap work which **changes code**, so every fix pushed afterwards restarts CI and pays the overlap straight back. Filing changes no code, so the CI already running stays valid. The first round still happens before the commit and "Pre-commit Self-Review" is untouched. The second round is the one thing that does run beside CI, on the same mechanism read the other way: it reads only the fix delta and its usual result is no code change — "The pull request opens between the rounds, so CI runs beside round 2" above, joshuafolkken/kit#1261.

  1. File the follow-up Issue referencing the current one (above), tagged `route:review-cap` so the backlog stays countable by filing route rather than by grepping issue bodies (joshuafolkken/kit#1083): `gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:review-cap' -f body="<body referencing the current Issue>"`.
  2. Run `pnpm josh epic:bundle <new>` — **before the current Issue closes.** The candidate search reads open issues only, so once the parent has closed the command answers `none` permanently and the relation can no longer be found (joshuafolkken/kit#947).
  3. Act on its answer. **`epic:bundle` recommends and writes nothing**, so acting means running the write command yourself — never a hand edit of the epic body, which leaves the task list and the `blocked-by` relations disagreeing and `epic:next` returning `error`.

  | Answer                                                                                                                                                                                                                                                                                                                                                                                                     | Do                                                                                                                                                                                                                                                                   | Tier                    |
  | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
  | `add_to_epic`                                                                                                                                                                                                                                                                                                                                                                                              | `pnpm josh epic --add <E> <new>` — add `--before <M>` / `--after <M>` when the relation carries an order                                                                                                                                                             | **A — no confirmation** |
  | `create_epic`                                                                                                                                                                                                                                                                                                                                                                                              | `pnpm josh epic "<title>" <new> <other> [--ordered]`                                                                                                                                                                                                                 | **A — no confirmation** |
  | `ask` — candidates spread across two or more epics                                                                                                                                                                                                                                                                                                                                                         | Stop and ask; merging epics is the one branch that is not reversible. **Inside an `epicrun`, park the child with `needs-decision` and continue** rather than stopping the batch, exactly as any other Tier B does there                                              | **B**                   |
  | `none`                                                                                                                                                                                                                                                                                                                                                                                                     | Nothing                                                                                                                                                                                                                                                              | —                       |
  | **The command could not answer** — non-zero exit, or **any** ⚠ warning above a `Nothing to bundle.` verdict: a truncated listing, or an issue whose relations could not be read. A recorded dependency is one of the two strong signals, so a failed relation read turns a real `add_to_epic` into `none`. A definitive answer (`Add it to the epic …`, `Already in an epic`) stands even beside a warning | Stop and report, naming what it said. **A `none` printed after such a warning is not "nothing to bundle"** — the search was incomplete, and reading it as an answer files the Issue into no epic on the exact path this rule exists to close (joshuafolkken/kit#950) | —                       |

  **`none` is a real answer, not a failure.** A standalone pre-commit review has no current Issue for the new one to reference, so no candidate exists and the Issue stays in the backlog for a person to place. What the step requires is that the command is run while the parent is still open and its answer acted on, never that an epic is found.

  Measured, not theorized: joshuafolkken/kit#943 was filed from a second review round with `親: joshuafolkken/kit#891` written in its body, and belonged to no epic. Its parent closed three minutes later. Where the step _was_ taken — joshuafolkken/kit#911, out of the same round cap — `epic:bundle` named the epic and the Issue was added to it. The only difference was whether the command was run (joshuafolkken/kit#946).

- **A confirmed High is never deferred.** The three-way disposition covers Low and Medium only: a real defect does not ship because a round counter ran out, so a standing High blocks the merge — it is never fixed-in-place, filed, or dropped as one of the three exits.
- **Blocking the merge is not the same as buying more rounds.** If a High is still standing after the second round, do not start a third — two rounds of fixing failed to close it, and a third is the review chasing its own tail. It says the change itself is not ready: stop, send a `confirmation` Telegram, and put the scope back to the user, where splitting the Issue is usually the answer.

The cap is deliberately mechanical rather than a judgement call, because judgement is what fails here: on #854 the third and fourth rounds were spent on findings that the Low rule already permitted skipping — a misplaced comment, an unused export, a stale comment — treated as blockers because the review returned them without severities.

---

## Review output format

Output every category below with an explicit verdict. Do **not** omit categories.

**This is the first round's format.** The second round is a verification pass and has its own, narrower one — see "The second round is a verification pass, not a second full review" above.

For each finding:

- Cite `file_path:line_number`
- State **severity** (`high` / `medium` / `low`) — decided by the two tests in "Severity" above, not by discretion
- Explain the concrete problem and the minimal fix
- On a finding that passes test 1 of "Severity" but is rated `low`, write the attempt: `no failure scenario — <what you tried>`

For categories with no findings, you **must** write a brief proof statement — not just `No issues`. Example: `No issues — checked null returns on X, verified Y edge case, Z is guarded by type.` A bare `No issues` is only acceptable for Security, Performance, i18n, and Comments when there is genuinely nothing to check (no auth code, no hot paths, no user strings, no comments touched).

Template:

```md
### Bug risks & logic errors

- `src/foo.ts:42` (high) — <problem> — <fix>

### Security

No issues — no auth code, no user input, no unsafe casts in diff.

### Performance

No issues — no loops, no reactive chains, no I/O on request paths.

### Project conventions

No issues — verified snake_case, no arrow functions, no magic numbers, i18n covered.

### i18n

No issues — no user-visible strings added.

### Tests

- `e2e/foo.test.ts:15` (medium) — assertion does not fail if implementation is inverted — rewrite to verify X not just that code runs

### Comments & content

No issues

### Assumptions audit

1. <assumption the implementation makes> — <what breaks if violated>
2. ...

### Confidence floor

<One concrete thing in this change I am least confident about, and why.>

### Summary

<total counts by severity and overall go/no-go>
```

---

## Review categories (must all be checked)

All nine are checked in the first round. **The second round checks category 1 plus the categories its fix delta actually touches** — the verification pass above, which is the only thing that narrows this list.

### 1. Bug risks & logic errors

Actively try to break the changed code before concluding it is correct.

- **Off-by-one, nullability, promise handling, race conditions**: for every modified function that has branching logic, trace at least one non-happy-path scenario. Write the trace explicitly: `Traced [input/state] → [result] — confirmed/flagged because [reason]`.
- **Broken invariants, wrong return types, mishandled edge cases**
- **Boundary values and concurrency**: empty / zero / max inputs, unawaited promises, shared state, re-entrancy
- **Impact outside the diff**: for every changed export or signature, open its callers and verify they still hold; flag duplication the change introduces
- **Regressions**: does the change break any existing behavior covered elsewhere?

`No issues` requires at least one explicit trace statement. Stating `No issues` without a trace is not allowed.

### 2. Security

- Injection (SQL, command, path traversal), XSS, CSRF
- Auth / authorization gaps, secret or token handling, unsafe deserialization
- Unsafe `as` casts that widen trust boundaries

### 3. Performance

- Obvious hotspots, N+1 queries, unnecessary re-renders / reactive churn
- Large payloads, unbounded loops, blocking I/O on request paths
- Avoid speculative micro-optimization — flag only concrete impact

### 4. Project conventions (`CLAUDE.md`)

**The gate has already run — do not re-verify what lint enforces.** `pnpm josh gate` precedes this review, and `pnpm josh format:edited` runs `eslint --fix` and `prettier --write` after every `Edit` / `Write`, so anything ESLint decides has already failed as an error or been corrected before you read the diff. Re-checking it inflates the first round's finding count, and in this document's own words every fix creates new surface — so a round spent on settled questions is what feeds the next one (joshuafolkken/kit#1221).

**Settled by lint, and therefore not checked here** — each one verified against the rule that enforces it, never assumed:

- **Naming** — `@typescript-eslint/naming-convention` (`eslint/rules/naming-convention.js`).
- **`export default`** — `import/no-default-export` is `error` project-wide (`eslint/rules/import.js`), switched off only for `*.d.ts` in `eslint/base.js`.
- **Individually named exports of function declarations, and of consts that are not `UPPER_CASE`** — `no-restricted-syntax` in `eslint/rules/code-quality.js`. **Its selector exempts `ArrowFunctionExpression`**, so `export const helper = (s: string): string => s` passes it; that gap is a reader's job, below.
- **File names** — kebab-case through `unicorn/filename-case`.
- **Magic numbers** — `@typescript-eslint/no-magic-numbers`; **`any`, unused vars, floating promises and explicit param and return types** — `eslint/rules/typescript.js` and `eslint/rules/promise.js`.
- **Identical functions and repeated string literals** — `eslint/rules/sonarjs.js`.
- **Every quality limit below.**

- **Quality limits**: a reference, enforced by `eslint/rules/code-quality.js` and `eslint/rules/sonarjs.js` rather than re-checked here — function complexity ≤5, nesting ≤2, function ≤25 lines, file ≤300 lines, params ≤4, statements per function ≤10, cognitive complexity ≤4 — **the line counts are code lines, not physical lines**: `max-lines` and `max-lines-per-function` run with `skipBlankLines` and `skipComments`, so read what `pnpm josh lint` reports rather than `wc -l`, and test files (`*.test.ts` / `*.spec.ts` / `*.e2e.ts`) allow 35 code lines per function instead of 25.

**What only a reader can see — check these:**

- **`function` syntax rather than an arrow const** — **no rule enforces this**: there is no `func-style` and no arrow selector anywhere in `eslint/`, and the named-export selector above explicitly exempts `ArrowFunctionExpression`. So `const do_thing = (n: number): number => n + 1` and `export const helper = (s: string): string => s` both lint clean, and this review is the only thing between either and the default branch. The route-file exemption in `CLAUDE.md` covers the named route handlers and nothing else.
- **The early-return one-liner** — `curly` is configured `['error', 'multi-line']`, which requires braces on a multi-line body and never requires the one-liner form. A short `if (x) { return y }` passes lint, so "single `return` under 100 chars → one-liner `if (x) return y`" is a reader's check.
- **Duplication that is not identical** — `sonarjs/no-identical-functions` sees only functions that match. Two implementations of one idea in different shapes are invisible to it, and they are exactly what "No clones — single-source" is about, package boundaries included.
- **A name that satisfies the convention and says the wrong thing** — `naming-convention` checks the shape, never the meaning. An `is_` prefix on a function that returns a parsed value passes lint and misleads every caller.
- **Grouping and layout** — a namespace object that collects unrelated functions, or a file whose contents no longer match what its name says. Structure is not something lint judges.
- **Svelte semantics** — `$state` reassignment, `Props` as an interface name, restricted DOM manipulation, and `PascalCase.svelte` / `PascalCase.svelte.ts` file names where the project's lint does not cover them.
- **Test file names and placement** — `eslint/rules/test-filename.js` bans `*.spec.ts` / `*.spec.js` and a top-level `tests/` directory **in a project that wires it in**. kit exports that rule for consumers and does not apply it to itself (joshuafolkken/kit#1233), so in this repository both patterns are a reader's check. Colocation beyond those two is a reader's check everywhere: a test that avoids both and still sits away from the code it exercises is not something the rule sees.

**A gate finding that got through is still a finding.** If lint could have caught something and did not — a disabled rule, an ignored path, an `// eslint-disable` the change added — say so. That is a defect in the gate, and no other step is looking at it.

### 5. i18n

- All user-visible strings (labels, buttons, toasts, validation errors, page titles) use message keys
- Message keys are added to **all** locale message files, not just one
- No hardcoded user-visible strings slipped in

### 6. Tests

- Every code change has a corresponding test (unit or E2E) per `CLAUDE.md` Code Change Rules Step 0
- Test titles are English only
- Test names describe behavior, not implementation
- **Mutation check**: for the most critical test added or changed, ask: "If I inverted or removed the key assertion/condition in the implementation, would this test fail?" If the answer is no or uncertain, the test does not verify the behavior — rewrite it.
- **Requirement check**: does the test verify the behavior described in the issue/task, or just that code executes without error?

### 7. Comments & content

- Comments are English only
- No narration comments (`// Added for issue #123`, `// TODO: refactor later`) — only comments explaining non-obvious _why_
- No duplicated logic that should be extracted

### 8. Assumptions audit

List 2–3 implicit assumptions the implementation makes. For each, state what would break if the assumption were violated. This section cannot be empty or say "No assumptions."

Examples of assumptions worth naming:

- "The API always returns an array (not null)" — would break with a null-ref if the API changes
- "The locale file always has this key" — would silently show a key string if a locale is missing
- "The animation completes before the next interaction" — race condition if the user acts fast

### 9. Confidence floor

State the **one concrete thing** in this change you are least confident about, and explain why. This section cannot say "Nothing" or "No concerns." If genuinely nothing is uncertain, trace the exact logic path that gives you that confidence — that trace itself is the proof.

---

## Stop conditions

- **High** findings → must fix before committing
- **Medium** findings → must fix before opening the PR
- **Low** findings → document in the PR body if skipped

If the diff is empty or trivial (e.g. whitespace only), state that explicitly and skip the review.

---

## Auto-continue rule (fullrun-conditional) — read this BEFORE sending the review

**This rule fires only when `/code-review` was invoked inside a `fullrun` / `fullrun new` / `queue` workflow.** Standalone `/code-review <PR>` invocations are exempt — for those, stop after the review markdown as normal. **A `halfrun` invocation NEVER enters fullrun mode** — halfrun runs this same review inside its verification gate, but it ends at the confirmation stop without committing: once the review settles, send the `confirmation` Telegram and stop with the work uncommitted.

### How to tell which mode you are in

You are in **fullrun mode** if BOTH of the following hold:

1. The user's recent message (within the current conversation) contained `fullrun`, `fullrun new`, or `queue` as a typed command. The keyword is the only valid signal: pipeline markers (issue normalized, `josh latest` run, branch created, `pnpm josh git -y` invoked) no longer distinguish `fullrun` from `halfrun` and MUST NOT be used to infer fullrun mode.
2. The implementation is finished and the verification gate has reached its review step. **Neither the presence nor the absence of a pull request is a signal about the mode**: round 1 runs before the commit, so none exists yet, while round 2 runs beside the CI that commit started, so one does — and a standalone `/code-review <PR>` is invoked against one too.

If either condition is false, you are in **standalone mode** (or the halfrun confirmation stop) — do not call `followup --merge`.

### What to do in fullrun mode

Before your response (the one containing the review markdown) is sent, run this self-check:

1. Count high/medium-severity findings across all categories.
2. If **any** high/medium findings exist → fix them in place and run the **second-round verification pass** — `/code-review` with the brief `pnpm josh review:brief --round 2` prints, which hands over the fix delta as the target and asks whether each finding closed, not a second full read of the diff (see "The second round is a verification pass, not a second full review"). **The pull request opens before that pass, not after it** — `pnpm josh bump minor` → `pnpm josh gate` → `pnpm josh git -y`, so CI runs beside round 2 (see "The pull request opens between the rounds, so CI runs beside round 2"). A finding round 2 then fixes in place is committed on top, after its own gate join, and CI re-runs on that commit. **Stop at two rounds** — after the second, route each remaining non-High finding through the three-way disposition (see "Review round cap"): fix it in place without starting a new review round, file it, or drop it with a one-line PR note. For a finding that is filed, run `pnpm josh epic:bundle <new>` on it **before this Issue closes** and act on its answer — `add_to_epic` / `create_epic` are Tier A, run the matching `pnpm josh epic` write command without asking; `ask` stops (or parks the child inside an `epicrun`); `none` is a no-op — then continue the pipeline; a standing High blocks the merge but does not authorize a third round. **Do NOT call `followup --merge` yet.**
3. If **no** high/medium findings exist (Low-only or completely clean) → your response MUST continue the pipeline in tool calls **after** the review markdown, in the same response: `pnpm josh bump minor`, then `pnpm josh git -y "<title> #<N>"`, then the follow-up filing and `pnpm josh epic:bundle` for anything the cap routed to branch 2 — placed here so it runs inside the CI wait — then `pnpm josh followup "<title> #<N>" --merge --notify-message "..."`. **Do NOT end the turn with review markdown as the final assistant text.**

### Concrete failure pattern to self-recognize

If you are about to send a response whose final text is the `/code-review` Markdown — with sections, severity-tagged findings, and a recommendation line — and **no tool call follows**, that response is a chain-rule violation. Cancel it. Add the `pnpm josh bump minor` → `pnpm josh git -y` → follow-up filing and `pnpm josh epic:bundle` → `pnpm josh followup --merge` tool calls to the same response before sending.

This rule mirrors the chain-rule decision table in `.claude/skills/workflow-commands/chain-rule.md`, which is its single source. It is repeated here because the violation point is at the moment the review skill finishes producing markdown — the rule must be visible in the skill's own context, not just in the always-loaded project docs.
