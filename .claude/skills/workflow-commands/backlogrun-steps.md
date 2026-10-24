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

**`pnpm josh issue:file` judges `auto-ok` and prints it** — `auto-ok: applied` or
`auto-ok: not applied` with the reason (`scripts/issue/issue-auto-ok.ts`). Every filing, the
retrospective's included, is judged the same way: the excluded labels, then the body's `- 人の判断:`
declaration (`issue-template.md`). **Declare `- 人の判断: 要` when the new issue needs a person's
judgement** — a Tier B toss-up or a Tier C action inside it; `--no-auto-ok` withholds it too.

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
pnpm josh run:carry --begin "backlogrun --max 5 --idle 30" --owner "$PPID"
pnpm josh run:carry --json                                                   # read it back in a resumed session
pnpm josh run:wake --start                                                   # same turn as --begin; `running` under `josh backlogrun`
```

**Always pass `--owner "$PPID"`**, before the plan, in the same turn as the first `pnpm josh ms`. **The
record is the parent loop's; a lane never touches it**. Count with `--merged <N>` and `--filed 1`;
**`--cut` is the session's last write**.

| It answers | What the run does |
| --- | --- |
| `began` | Report the plan and run the decision pass, then run what the bare `pnpm josh run:step` prints — an empty plan or a `none` from `backlog:next` included, which the driver's idle watch ends, never the session |
| `resumed` | Take the budget from `--json`, report the plan again, read `backlogrun-progress.md` → "Resuming after a cut" |
| `busy` / `mismatch` / `unreadable` / `unknown` | **Stop; do not open a lane** — report what it printed; never resume into another invocation's record |
| `over` | **End the conversation**; retype the invocation in a fresh session |
| `standing` | **Stop; do not open a lane**: report `pnpm josh backlogrun --restart` (continue the run) and `pnpm josh run:carry --end` (discard it) for the person to choose — a crash from a run-tooling defect this run has since fixed you resume yourself (`upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合") |
**End the record when the run ends** — `pnpm josh run:report`, then `pnpm josh run:carry --end`, **never
batched with it**, and `pnpm josh run:wake --stop` in the same turn. **A run that ends by _stopping_**
(a `stop` verdict or the consecutive-failure guard) **ends with `pnpm josh run:carry --end --stopped
"<one-line reason>"`** instead, which sends the one ⏸️ confirmation.

**A driver hand-off of `epic #N` is a named epic**: settle it by `backlogrun-progress.md` → "Running a
named epic's children", never the root as a standalone `fullrun`, then ask `pnpm josh epic:next <E>` —
a child number or `complete` continues; only `stop` or a failure records `pnpm josh run:carry --done <E>
--owner "$PPID"`.

**A person keeps control** — `pnpm josh run:wake --list` reads it, `pnpm josh backlogrun --stop` stops
it (`docs/josh-commands.md` → "`josh backlogrun`").

## The plan, before the first child starts

**Report the plan before anything is dispatched. The plan is one command's output** — `pnpm josh
backlog:plan`, from the pool `backlog:next` answers from. Report all four sections (Ready now, Waiting,
Waiting on a person, Out of scope) in the session language, with any truncated-listing `⚠`.

### Resolve what the plan can resolve, before starting

**Settle every `needs-decision` issue the plan listed in one pass**, from one `pnpm josh issue:read <N>
<N> …` call (`issue-comments.md`):

- **An answer already in the issue** — record it as a comment and **remove the label** with `pnpm josh run:park <N> --clear` (Tier A).
  **Never measure in order to decide**: a question needing a benchmark or a run stays labelled.
- **A person's judgement** — apply `needs-decision` (`backlogrun-park.md` → "Only a person's judgement
  carries `needs-decision`").
- **Order and isolate** — a native `blocked-by` where one must land first; `run:solo` on all three
  `backlogrun-lanes.md` → "A solo run" conditions, **every other one `run:lane`**, commenting the
  reason.
- **`priority:critical` / `priority:high`** are applied at filing by `pnpm josh issue:file` from the
  body's `- 優先度:` declaration (`issue-template.md`); **only a person removes them**.
- **Report `pnpm josh backlog:plan --waves`** with the plan, never an order derived by hand; then start
  the loop, leaving whatever is still labelled parked.

**`needs-decision`, `run:solo` and `run:lane` are the only workflow labels a run applies by hand** —
never `needs-human-review` (`needs-human-review.md`), the priority labels only through
`pnpm josh issue:file`, and `auto-ok` only through it or `pnpm josh auto-ok:judge`.

## The loop

**The loop is computed, not walked by hand** — the `run:wake` supervisor runs `pnpm josh backlog:drive`
(`docs/josh-commands-backlog.md` → "`josh backlog:drive`"). A session reaches this section only when
the `Driver result:` line hands a branch back: claim with `pnpm josh run:carry --resume "<invocation>"
--owner "$PPID"`, act on the row, then `pnpm josh run:carry --cut --owner "$PPID"`. Read only the one
section the row names:

| Handed back | What the session does | Read |
| --- | --- | --- |
| `triage` | Label each issue stderr names `run:solo` or `run:lane` (`blocked-by` where one must land first) | "Resolve what the plan can resolve, before starting" above |
| `judge` | For each number `pnpm josh auto-ok:judge` prints, read the issue (`pnpm josh issue:read <N>`) and answer `--apply <N> --lane\|--solo` or `--decline <N> --reason "<why>"` | `docs/josh-commands-backlog.md` → "`josh auto-ok:judge`" |
| `offer` | Report what stderr printed — a failed offer, or a named issue whose state stayed unreadable; **never pick an issue by hand** | — |
| `launch #N` | Read the lane's log and park `#N` | `backlogrun-park.md` → "park and continue" |
| `merge [<token>] #N` | `environment` ends the run; the others re-read the child | `backlogrun-progress.md` → "Running a named epic's children" |
| `epic #N` | A named epic's turn | "The session cut is inside the invocation" above |
| `watch` | The retrospective is owed (`run:step`) | `retrospective.md` |
| `window` | Hand the loop back as is | — |

**A candidate only in another repository is never a token** — report it with its checkout. The budgets,
verdicts and stops are the driver's own.

## What runs once per session, not once per issue

| Step | Where it is defined |
| --- | --- |
| `run:carry --begin` + `run:wake --start` before the plan; `run:carry --end` + `run:wake --stop` at the end | "The session cut is inside the invocation" above |
| `pnpm josh ms`, `pnpm josh latest:if-required`, `lane:prune` in the primary checkout before the first lane | `backlogrun-lanes.md` → "Once per repository, before the first lane opens" |
| `josh latest` on `required` only, once, never in a lane | `backlogrun-child.md` → "`josh latest` runs once per session, not once per child" |
| `pnpm josh run:hold <N>`'s preflight, before each child not in a lane | `docs/josh-commands-run.md` → "`josh run:hold`" |
| `pnpm josh run:progress --wait` in the background, `--mark` at every real report | `progress-watcher.md` → "Progress while the run is quiet" |
| `pnpm josh release:scope` once, after the last merge and lane close | `followup.md` → "When `pnpm josh release` runs" |

**`pnpm josh epic:audit` is not run.** There is no epic to audit — the run began from the backlog.
