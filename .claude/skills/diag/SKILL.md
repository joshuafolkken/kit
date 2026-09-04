---
name: diag
description: The procedure behind `diag fullrun` / `diag epicrun` / `diag #<N>` (and `/diag`) — measure where a run's wall clock actually went with `pnpm josh time`, say whether the last speedup issue worked, and rank what to cut next as one table that keeps the already-filed issues in it. Read this whenever asked how long a run took, why `fullrun` is slow, what to do to make it faster, or to check whether a speedup landed.
---

# `diag` — read the timing report, propose the next speedup

The measurement is a command; deciding what to cut from it was still being pasted in as a prompt
every time. Two real requests, three weeks apart, asked for the same thing in different words — one
asked for a verification of the previous speedup and one did not, so the two answers were not
comparable (joshuafolkken/kit#1270). This skill is that request written down once.

**`diag` is analysis, not a workflow.** It never implements, commits, merges or starts a run. Where
its answer is "run this", it prints the command for the person to type — the explicit-invocation
rule in `CLAUDE.md` is unchanged, and `diag` is not one of the keywords it governs.

## Which run to measure

| Typed | What it measures | The call |
| --- | --- | --- |
| `diag` / `diag fullrun` | The most recently merged run | `pnpm josh time --json` |
| `diag #<N>` | Issue `#N`'s whole run, from the `fullrun` invocation to the merge | `pnpm josh time --issue <N> --json` |
| `diag epicrun` / `diag #<E>` where `#<E>` is an epic | Every child of the epic, in execution order | `pnpm josh time --epic <E> --json` |

An epic is measured child by child because a run is measured from its `fullrun` invocation to its
merge, and an `epicrun` is several of those. **One call does the whole batch**
([#1271](https://github.com/joshuafolkken/kit/issues/1271)): `--epic` enumerates the children from
the epic body itself, orders them by when they actually ran, and carries each child's own report
under `children[]` — so there is no loop to write and no list of numbers to assemble first. It also
prints the **model wait per turn** of each child and the direction across them, which is the one
figure a `--issue` call per child could never produce.

**Read the four child states before quoting a figure.** `not run`, `no transcript` (merged, but no
session transcript attributed — only the CI wait is known) and `not merged` are not durations of
zero, and the batch totals withhold any half no child contributed to. A child named in one of those
states is reported as unmeasured, never counted as zero.

## 1. Measure with `pnpm josh time`, never by hand

```bash
pnpm josh time --json               # alias: josh tm
pnpm josh time --issue <N> --json
pnpm josh time --epic <E> --json
```

**Never write a script to read the transcripts, and never restore the timings by eye.** That is what
the command replaced, and a second reader is a second classification — the one thing a measurement
meant to compare two runs must not have. If the command cannot answer, report what it printed and
stop; it says which of `--issue` / `--session` picks a scope, and it exits non-zero rather than
printing a table of zeroes.

Read from the JSON, in this order:

- **the four shares** — model wait, tool execution, human wait, CI wait. **A run with `span_count: 0`
  measured none of the first three**: the JSON still carries their milliseconds as `0`, and that zero
  is an unknown rather than a measurement — the printed table says so with `not measured`. Ranking a
  stage off them there is ranking an unknown
- **the phase breakdown** — `plan` / `setup` / `implement` / `gate` / `rework` / `review` / `pr` /
  `wrapup` / `ci` / `merge` / `wait` / `pre-run` / `post-run` / `other`, which says which *stage* is
  long where the per-tool table says which *command* is slow. **`pre-run` and `post-run` are not
  stages and are never ranked** (joshuafolkken/kit#1299): they are what the branch attribution swept
  in from before the run opened and after it merged, so a cut proposed against either would cut a
  different piece of work. `setup` and `wrapup` are the run's own, and both can be ranked.
- **`is_detected` per phase** — a phase that never appeared prints `not detected`, and that is not a
  measured zero. Never rank a phase you did not measure. `wait` and `other` rest on no marker, so
  they are `false` only where no span was read — the same state the three transcript shares are
  withheld in.
- **the round trips** — `tool_call_count` and `round_trip_count`, and the density between them
  (joshuafolkken/kit#1304). Once the verification commands were cut, this is what sets a run's floor:
  the tools themselves run for well under a minute while the turns they sit in cost ten times that.
  **A density near 1.00 is the finding, not a detail** — it says independent calls went out one per
  turn, and the printed block says so in a line. It rests on the same transcript the three shares do,
  so a scope with `span_count: 0` measured none of it either
- **the price of one round trip** — `ms_per_round_trip`, with `model_ms_per_round_trip` beside it
  (joshuafolkken/kit#1307). The counts above say how *often* a run went round; this says what one of
  them is worth, and **without it the round trips cannot enter step 3's table at all** — that table
  ranks by minutes saved per run, and a count is not minutes. Multiply the price by the trips a
  proposed change would remove, and rank the product against the phases. **The model share is the
  part batching actually removes**, because a tool's own execution is paid whichever turn it was
  issued from. **The price is not a share of `elapsed_ms`** — human wait, CI wait and the turns that
  called nothing are all outside it, so the product can be ranked beside the `wait` and `ci` rows
  without counting the same minutes twice. It is withheld rather than zeroed where there was no round
  trip to divide by
- **the per-tool and per-`josh <cmd>` totals** — where a single command is the cost. **Rank a tool by
  its round trips as well as its duration**: a tool called thirty times one call per turn costs thirty
  round trips at the price above, which is routinely larger than the seconds the calls themselves ran
  for — the reading that was missed before the price was reported

## 2. Say whether the last speedup actually worked

Re-measure the earlier run with `pnpm josh time --issue <M> --json` and compare it against step 1 on
the phase the speedup issue named. State the verdict in one line — worked, did not, or cannot tell —
with both figures beside it.

- **Compare the same phase, not the totals.** Human wait swamps everything and moves for reasons no
  change controls, so a run that got slower overall can still carry a phase that halved.
- **One run is not a sample.** Where two runs disagree, say so rather than picking the one that
  supports the change.
- **"Cannot tell" is an answer.** A phase that is `not detected` in either run, or a run with no
  merge read, cannot support a verdict, and reporting one anyway is how a speedup that did nothing
  keeps its reputation.

## 3. One ranked list — already-filed issues stay in it

Emit **one** table, ordered by the time each item would save per run, largest first. Estimate that
saving from step 1's figures, not from how easy the work looks.

**Do not drop an item because it is already filed.** Avoiding duplicates means not filing a second
issue for the same work; it does not mean leaving the work out of the ranking. **A filed but
un-started issue is usually the highest-priority action in the table** — it needs no filing at all,
only a run — and a table that hides it reports the backlog as emptier than it is and re-proposes the
same work a week later.

| State | What the row prints |
| --- | --- |
| Un-filed | The proposal, and the estimated saving. Go to step 4 |
| Filed, not started | `#N`, and **the command to run next** — `fullrun #N`, or `epicrun #E` for the epic that tracks it. Never a second filing |
| In progress | `#N` and that it is in progress. Do not propose running it again |
| Done | The verdict from step 2 — whether it worked, with both figures |

**Read the state from `pnpm josh issue:state <N>`, never by parsing `gh` output yourself.**

```bash
pnpm josh issue:state <N>
# state: OPEN
# labels: in-progress, route:split
# human_review: no
```

It is the command because `gh issue view --json state` goes through GraphQL, which a cloud session
is refused, and because the `OPEN` / `CLOSED` casing rule then lives in one place rather than in
prose. Map its output to the table above: `CLOSED` is **done**; `OPEN` carrying `in-progress` is
**in progress**; `OPEN` without it is **filed, not started**. A number that `does not resolve`, or a
read that answers `could not read`, is reported as unknown — `could not read` is a failed read,
never "the issue is open".

**Matching `in-progress` is yours to do, and the `labels:` line is compared case-insensitively —
lowercase that one line before matching, and leave the `state:` line's casing alone.** Only
`human_review:` arrives already decided that way; `labels:` prints the spelling each label was
created with, and GitHub treats `In-Progress` as the same label as `in-progress`. A match against
the lowercase string alone reports an in-progress issue as un-started, and the table then tells
someone to start a run that is already going — the failure this whole step exists to prevent.

Which epic to name for a filed row comes from `pnpm josh epic:bundle <N>`, which names the epic that
already tracks it rather than only reporting that one exists. **Read
`.claude/skills/epic-commands/SKILL.md` before running that or any other `epic:*` command**, as
`CLAUDE.md` requires — this skill routes to it rather than restating it.

## 4. File only through `pnpm josh issue:scout`

An un-filed row is filed only after the scout has answered:

```bash
pnpm josh issue:scout "<title>" --body "<one line, citing the issue this follows from>"
```

- **`Duplicates:` is read, not skimmed.** Open each candidate. One that covers the same work turns
  the row from un-filed into filed — move it to that state in the table, with the command to run —
  and **do not file**.
- **Pass `--body`.** The epic half decides from the issue numbers the summary names, so a title-only
  call answers `Epic: not asked`, which is not `Epic: none`.
- **`Epic:` is the placement**, and `add_to_epic` / `create_epic` are Tier A: execute them with
  `pnpm josh epic --add` / `pnpm josh epic`, never by hand-editing an epic body. `ask` stops.
- Filing is Tier A only for a first-party target — an owner equal to this repository's. A
  third-party tracker is Tier C and is not written to here (`CLAUDE.md` → "Third-party repositories
  are Tier C").
- Run `pnpm josh epic:bundle <new>` on each issue filed, so it is one `epic:next` will offer rather
  than one parked forever.

## What `diag` does not do

- It does not implement anything, and it opens no pull request.
- It does not run `fullrun` / `epicrun` on what it ranks. It prints the command; the person types it.
- It does not measure anything itself. Every figure in its report came out of `pnpm josh time`.
