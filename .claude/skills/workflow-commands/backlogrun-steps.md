# `backlogrun` — the detailed procedure behind the manifest

Point-of-use, read one section at a time from `backlogrun.md` → "The manifest — the ordered flow".

## What one invocation approves

**One `backlogrun` approves every merge of every issue `pnpm josh backlog:next` offers** — `auto-ok`
issues, every child of an epic whose root carries it, and a run's own filing once `pnpm josh
epic:bundle` (Tier A, `observation-filing.md`) has placed it under such a root. **A named issue is
approved by the keyword and its number, not by `auto-ok`**. What runs is stated by the keyword and its
arguments, never inferred. **Two repairs that would bound this the other way are prohibited** —
dropping a run's own filings, and requiring a person's `auto-ok` on a child; the brake below bounds it.
A Tier C action inside a child still stops that child.

**`pnpm josh issue:file` judges `auto-ok` and prints it** (`scripts/issue/issue-auto-ok.ts`).
**Declare `- 人の判断: 要` when the new issue needs a person's judgement** — a Tier B toss-up or a
Tier C action inside it (`issue-template.md`); `--no-auto-ok` withholds it too.

### The brake that replaces the promise

**Every bound is counted by a record or a guard rather than in the conversation:**

| The bound | What it limits | Counted by |
| --- | --- | --- |
| `--max` | merges per invocation — a run's own filing competes for it | `run:carry --merged` |
| `--idle` (8 hours unless typed) | how long the run waits once nothing can proceed | `--active`, the moment its hands became free |
| **Ten filings per originating work item** | additions to the pool on **every** filing route (`prerequisite.md`) — `route:tier-a`, `route:interrupt` and a review branch-2 filing are exempt from the depth test (`observation-filing.md`), never from this ceiling | `scripts/issue/issue-file-cap.ts` |
| The WIP cap on open issues | the pool across invocations | `prompts/collaboration-workflow/wip-cap.md` |

**This section is the single source of how the `epic:bundle` obligation and this boundary meet.**

## Named issues run first, in order

**`backlogrun #N1 #N2 …` runs the named issues before it touches the pool**, in the order typed, **one
at a time — no lanes**, each as a `fullrun` in a delegated unit (`backlogrun-child.md` → "Each child
runs in a delegated unit"), read back with `pnpm josh issue:state <N>`. `pnpm josh backlog:plan #N1
#N2 …` renders the order (`scripts/backlog/backlog-named.ts`).

**A named issue that cannot finish parks, and the rest of the named list is skipped**; the run drains
the pool and reports what was not started (`backlog_named.after_failure`). One already closed or parked
when offered is booked done alone and skips nothing. A `needs-human-review` named
issue stops the whole run. **`--only` runs the named list and stops there, draining no pool** — a
failure ends the run, and `--only` with no named issues is refused (`backlog_named.startup`).

## The session cut is inside the invocation

**Typing `backlogrun` once authorizes the declared budget, and a session cut does not end the run** —
the next session resumes the invocation from the carry record (`backlogrun-progress.md` → "The
hand-off"), which keeps the invocation string, `--only` and the named list; it runs `remaining` from
`--json` (`docs/josh-commands-run.md` → "`josh run:carry`").

```bash
pnpm josh run:carry --begin "backlogrun --max 5 --idle 30"
pnpm josh run:carry --json                                   # read it back in a resumed session
pnpm josh run:wake --start                                   # same turn as --begin; `running` under `josh backlogrun`
```

**Begin it before the plan**, in the same turn as the first `pnpm josh ms`; the owner is the session pid
the agent exports (`--owner <pid>` only where it exports none). **The
record is the parent loop's; a lane never touches it**. Count with `--merged <N>` and `--filed 1`;
**`--cut` is the session's last write**.

| It answers | What the run does |
| --- | --- |
| `began` | Report the plan and run the decision pass, then run what the bare `pnpm josh run:step` prints — an empty plan or a `none` from `backlog:next` included, which the driver's idle watch ends, never the session |
| `driving` | The supervisor already holds the record — "The plan, beside the first child" |
| `resumed` | Take the budget from `--json`, report the plan again, read `backlogrun-progress.md` → "Resuming after a cut" |
| `busy` | Wait; do not open a lane — ask `--begin` again at the next wake |
| `mismatch` / `unreadable` / `unknown` | **Stop; do not open a lane** — report what it printed; never resume into another invocation's record |
| `over` | **End the conversation**; retype the invocation in a fresh session |
| `standing` | **Run `pnpm josh backlogrun --restart`**, then report it and `pnpm josh run:carry --end` (`scripts/backlog/backlogrun-restart.ts`; a run-tooling crash: `upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合") |
**End the record when the run ends** — `pnpm josh run:report --end`: the report, `run:carry --end`,
then `run:wake --stop`, stopping at the first failed stage, which it names. **A run that ends by
_stopping_** (a `stop` verdict) **ends with `pnpm josh run:report
--end --stopped "<one-line reason>"`** instead, which sends the one ⏸️ confirmation.

**A driver hand-off of `epic #N` is a named epic**, declared or added by `run:add`: settle it by `backlogrun-progress.md` → "Running a
named epic's children", never the root as a standalone `fullrun`, then ask `pnpm josh epic:next <E>` —
a child number or `complete` continues; only `stop` or a failure records `pnpm josh run:carry --done <E>`.

**A person keeps control** — `pnpm josh run:wake --list` reads it, `pnpm josh backlogrun --stop` stops
it (`docs/josh-commands.md` → "`josh backlogrun`").

## The plan, beside the first child

Under `josh backlogrun` the first lane opens while the plan is reported (`--begin` answers
`driving`); a run typed in a session reports it before its hand-off.

**The plan is one command's output** — `pnpm josh backlog:plan`, from the pool `backlog:next` answers
from, printed in the session language. Relay all four sections as printed, with any truncated-listing `⚠`.

### Resolve what the plan can resolve

**Run `pnpm josh backlog:triage --pass`** after the first offer and follow its one stdout command.
It settles mechanical lane candidates and batches the remaining judgments, `needs-decision` and
`run:stalled` issues into one body-and-comments read, once per local issue. Foreign-repository and
excluded children are not read. After recording answers, repeat it with `--exclude <N>`
for decisions left parked in this pass; when none remain it prints `pnpm josh backlog:plan --waves`.
The reader supplies semantic evidence; the command cannot infer a person's answer or prove a main failure:

- **A park the parent resolves** — `pnpm josh backlog:triage --apply <N> --adopt <k> --reason <text>`
  (`backlogrun-park.md` → "A park the parent session resolves").
  **Never measure in order to decide**: a question needing a benchmark or a run stays labelled.
- **A recovered mechanical failure** — retry with `pnpm josh run:add <N> --retry`, which clears
  `run:stalled` and the previous attempt; unresolved failures stay parked and excluded from this pass.
- **A person's judgement** — apply `needs-decision` (`backlogrun-park.md` → "Only a person's judgement
  carries `needs-decision`").
- **Order and isolate** — a native `blocked-by` where one must land first (`--blocked-by <M>`);
  the label from `pnpm josh backlog:triage --decide` (`backlogrun-lanes.md` → "A solo run"),
  in one call with the reason (`--clear` folds in the answered park): `pnpm josh backlog:triage`
  (`docs/josh-commands-backlog.md` → "`josh backlog:triage`").
- **`priority:critical` / `priority:high`** are applied at filing by `pnpm josh issue:file` from the
  body's `- 優先度:` declaration (`issue-template.md`); **only a person removes them**.
- **Report `pnpm josh backlog:plan --waves`** with the plan, never an order derived by hand; then start
  the loop (under `driving`, end the turn), leaving whatever is still labelled parked.

**`needs-decision`, `run:solo` and `run:lane` are the only workflow labels a run applies by hand** —
never `needs-human-review` (`needs-human-review.md`), the priority labels only through
`pnpm josh issue:file`, and `auto-ok` only through it or `pnpm josh auto-ok:judge`.

## The loop

**The loop is computed, not walked by hand** — the `run:wake` supervisor runs `pnpm josh backlog:drive`
(`docs/josh-commands-backlog.md` → "`josh backlog:drive`"). A session reaches this section only when
the `Driver result:` line hands a branch back. The supervisor already holds the carry record — never
run `run:carry --begin`; act on the row, then end the turn:

| Handed back | What the session does |
| --- | --- |
| `triage` | The session runs beside the driver, which keeps the carry: run no `run:carry`. Run `pnpm josh backlog:triage --pass` and follow its next command; resolve as above, leaving only genuine human questions parked |
| `judge` | For each number `pnpm josh auto-ok:judge` prints, read the issue (`pnpm josh issue:read <N>`), verify provenance (`docs/how-to/auto-ok-provenance.md`), then answer `--apply <N> --lane\|--solo` or `--decline <N> --reason "<why>"` |
| `offer` | Report what stderr printed — a failed offer, or a named issue whose state stayed unreadable; **never pick an issue by hand** |
| `launch #N` | The driver parked `#N` `run:stalled`: "Resolve what the plan can resolve" → "A recovered mechanical failure" |
| `merge [<token>] #N` | Re-read the child |
| `epic #N` | A named epic's turn |
| `watch` | The retrospective is owed (`run:step`): run `pnpm josh run:handoff retrospective` (`retrospective.md`) |
| `window` | Hand the loop back as is |

**A round starts with the initial plan or a batch of collected children.** A batch containing at least
one newly parked child hands back `triage` once, after all finished children are collected and before
another offer. The pass re-reads all parked children; its exclusions last only for that pass. A batch
with no park adds no triage step; a resumed driver does not repeat it.

**A candidate only in another repository is never a token** — report it with its checkout.

## What runs once per session, not once per issue

| Step | Where it is defined |
| --- | --- |
| `run:carry --begin` + `run:wake --start` before the plan; `run:report --end` at the end | "The session cut is inside the invocation" above |
| `pnpm josh run:prime` in the primary checkout before the first child | `backlogrun-lanes.md` → "Once per repository, before the first lane opens"; a first child outside a lane: `backlogrun-child.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight, before each child not in a lane | `docs/josh-commands-run.md` → "`josh run:hold`" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `progress-watcher.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last merge and lane close | `followup.md` → "When `pnpm josh release` runs" |

**`pnpm josh epic:audit` is not run on the opted-in backlog.**
