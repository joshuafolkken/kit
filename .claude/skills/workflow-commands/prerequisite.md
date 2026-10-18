# A prerequisite discovered mid-run — a dependency, not a park

**The single source of the prerequisite branch**, read at its point of use — the moment a run
discovers that another Issue in this repository has to land first.

**A prerequisite discovered mid-run is a dependency, not a park** — the Issue in hand is still one
deliverable, it just needs another one before it.

**Four kinds of other work turn up mid-run, and the procedure differs for each:**

| What turned up                                                              | What to do                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect originating in **another package**                                 | File the upstream Issue and **stop** — Tier A for a first-party target; a third-party one is Tier C, recorded and drafted rather than filed (`CLAUDE.md` → "Cross-package problems"; `prompts/collaboration-workflow/upstream-interrupt.md`) |
| This Issue was really **several** (a split)                                 | File the children and the epic and **stop** — except under `backlogrun`, whose authorization already covers a batch, so the children are filed and run through (`split-assessment.md`) |
| Another Issue in **this** repository has to land first (**a prerequisite**) | This section                                                                                                            |
| Something worth filing that is **none of the three** (**an observation**)   | File it **without asking** in an unattended run, propose it first in an interactive session — Tier A for a first-party target — and **carry the run straight on**: nothing is stashed, nothing is parked (`observation-filing.md`). **A delegated child does not file here**, and a filing at depth 1 or deeper cites the depth-0 work it blocked; one that cannot cite it goes to the run's own `.josh/observations/<N>.md` and is filed on its second sighting — all of them `observation-filing.md`'s |

**A stop on a defect in this repository's own gate or run tooling is a prerequisite too.** The
defect's Issue is the prerequisite — filed if it is not yet, used by its number if it is — and it is
never recorded as an upstream interrupt, because the tooling is not another package
(`prompts/collaboration-workflow/upstream-interrupt.md` → "実行中のリポジトリ自身のラン機構の不具合").

**A stop that a dependency can express is never a person's decision.** This is the single source of
that rule. A recommendation of "record `<N>` must land first and go on" is taken without asking;
`needs-decision` is reserved for a design decision nobody has made, a Tier B toss-up, or a Tier C
action. `pnpm josh run:merge` enforces the computable half: an unfinished child with an open
blocked-by is released to **wait** — no `needs-decision` label, no failure counted — and the backlog
offer hands it back once its blockers merge.

**A wait for the next published release is a dependency too** — never `needs-decision`. Record it
with `pnpm josh issue:release <M> --wait` (`<M>` blocked by the release Issue, filed when none is
open), then stash, comment and `pnpm josh run:release <M>` as for a prerequisite below; `fullrun` /
`halfrun` stop, `backlogrun` continues. Closing the release Issue once a person has published it hands
`<M>` back to `backlog:next` (`docs/josh-commands-backlog.md` → `josh issue:release`).

**File the prerequisite with the `route:tier-a` label** — it means a filing the run is *blocked by*,
so the observation row carries no `route:` label (`observation-filing.md`):

```bash
pnpm josh issue:file "<title>" --body-file <body-file> --route tier-a
```

The command lints the body against `prompts/collaboration-workflow/issue-template.md`, applies the
classification labels it declares, and runs the duplicate scan and `epic:bundle` itself
(`docs/josh-commands-backlog.md` → `josh issue:file`).

Every *file the prerequisite* step below means that filing, and it always happens **first** — the
later steps name its number. **Its duplicate scan is read exactly as it is for a `new` entry**
(`issue-scout.md`).

**Each entry point's own branch stays in that entry's file:**

- **A named epic under `backlogrun`** files without confirmation, records the dependency with
  `pnpm josh epic --add <E> <N> --before <M>` — `<E>` the epic, `<N>` the prerequisite just filed,
  `<M>` the child in hand — and the run **continues rather than parking it** (`backlogrun-park.md` → "A
  prerequisite discovered mid-run"). A child outside any epic records the same relation on itself
  directly; that branch is the same section's.
- **`fullrun` / `halfrun`** file the same way without asking, insert the prerequisite into the epic
  that already tracks the Issue or create one over both, and then **stop**, leaving the person one
  command to type (`fullrun.md` / `halfrun.md`). Typing `fullrun` approved implementing **one** Issue;
  a batch is a different authorization, so the stop stays.

**Two steps every entry's procedure turns on:**

- **`git stash push -u` — the `-u` is not optional.** The work in progress almost always includes a
  new, untracked `*.test.ts`, which a stash without `-u` leaves for the next `pnpm josh ms` to refuse.
- **The Issue comment is what gets the stash popped, not the Telegram.** The run that picks the Issue up
  reads it and pops before implementing — **by message, `pnpm josh stash:pop "<the -m message>"`, never
  a positional `git stash pop`** (the stack is shared by every lane). Say it in the Telegram too.

**Automatic filing is capped at 10 Issues per run** at every entry point; `pnpm josh rule:guard`
refuses the eleventh filing (`prompts/collaboration-workflow/rule-delivery.md`). On reaching it, stop
and report. `kickoff` is exempt — it never implements, so it never discovers one.
