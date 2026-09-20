# A prerequisite discovered mid-run — a dependency, not a park

**This is the body of `SKILL.md` §2d, relocated here so the entry read carries the trigger and the
pointer, not the procedure** (joshuafolkken/kit#2189). `SKILL.md` §2d is the resident stub, and each
entry file (`fullrun.md` / `halfrun.md` / `backlogrun-park.md`) routes here for the definition. It is
read at its point of use — the moment a run discovers that another Issue in this repository has to
land first.

**A prerequisite discovered mid-run is a dependency, not a park.** Finding that something else in
*this* repository has to land first is a third situation, distinct from an upstream defect and from a
split: the Issue in hand is still one deliverable, it just needs another one before it.

**Four kinds of other work turn up mid-run, and the procedure differs for each.** Reading one as
another is the failure this section exists to prevent:

| What turned up                                                              | What to do                                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A defect originating in **another package**                                 | File the upstream Issue and **stop** — Tier A for a first-party target; a third-party one is Tier C, recorded and drafted rather than filed (`CLAUDE.md` → "Cross-package problems"; `prompts/collaboration-workflow/upstream-interrupt.md`) |
| This Issue was really **several** (a split)                                 | File the children and the epic and **stop** — except under `backlogrun`, whose authorization already covers a batch, so the children are filed and run through (`split-assessment.md`) |
| Another Issue in **this** repository has to land first (**a prerequisite**) | This section                                                                                                            |
| Something worth filing that is **none of the three** (**an observation**)   | File it **without asking** — Tier A for a first-party target — and **carry the run straight on**: nothing is stashed, nothing is parked (§2i). **A delegated child does not file here**, and a filing at depth 1 or deeper cites the depth-0 work it blocked; one that cannot cite it goes to `docs/observations.md` and is filed on its second sighting — all of them §2i's |

**File the prerequisite with the `route:tier-a` label**, so a Tier A filing made during implementation
stays countable by filing route afterwards. **This paragraph belongs to the prerequisite row, not to
the table** — the label means a filing the run is *blocked by*, so the observation row carries no
`route:` label of its own (§2i):

```bash
gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=route:tier-a' -f 'labels[]=depth:<n>' -f body="<body>"
```

Every "file the prerequisite" below means that labelled filing, and it always happens **first**: the
steps after it name a number that does not exist until it is. **`pnpm josh issue:scout "<title>"` goes
in front of that call, exactly as it does for a `new` entry** (§2e): a filing made mid-run is the one
most likely to duplicate something.

**Each entry point's own branch stays in that entry's file:**

- **A named epic under `backlogrun`** files without confirmation, records the dependency with
  `pnpm josh epic --add <E> <N> --before <M>` — `<E>` the epic, `<N>` the prerequisite just filed,
  `<M>` the child in hand — and the run **continues rather than parking it** (`backlogrun-park.md` → "A
  prerequisite discovered mid-run"). Parking is only for a prerequisite that *cannot* be expressed as
  a dependency — one needing a design decision nobody has made, a Tier B toss-up, or a Tier C action.
- **`fullrun` / `halfrun`** file the same way without asking, insert the prerequisite into the epic
  that already tracks the Issue or create one over both, and then **stop**, leaving the person one
  command to type (`fullrun.md` / `halfrun.md`). Typing `fullrun` approved implementing **one** Issue;
  a batch is a different authorization, so the stop stays.

**Two steps every entry's procedure turns on**, both load-bearing rather than tidy-up:

- **`git stash push -u` — the `-u` is not optional.** The work in progress almost always includes a
  new `*.test.ts`, which is untracked, and a stash without `-u` leaves exactly those files in the tree
  for the next child's `git switch main && git pull` to refuse.
- **The Issue comment is what gets the stash popped, not the Telegram.** The run that later picks the
  paused Issue up reads that comment and pops before implementing — **by message,
  `pnpm josh stash:pop "<the -m message>"`, never a positional `git stash pop`**, because the stash is
  a repository-wide stack every lane shares and a positional pop takes whichever lane last pushed. Say
  it in the Telegram too — the comment is the record.

**Automatic filing is capped at 10 Issues per run** at every entry point; `pnpm josh rule:guard`
refuses the eleventh filing (`prompts/collaboration-workflow/rule-delivery.md`). On reaching it, stop
and report. `kickoff` is exempt — it never implements, so it never discovers one.
