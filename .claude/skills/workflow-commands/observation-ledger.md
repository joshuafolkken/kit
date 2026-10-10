# The observation ledger — grammar, commit path and promotion

**Read only when the depth test in `observation-filing.md` turns an observation away, or a user
reports a bug** (its kind of miss, below), in the turn that appends the line.
A run that files outright, or finds nothing, never reads it. This file is the single source of the ledger's grammar, its commit path and the
second-sighting promotion. Provenance: `docs/maintainers/observation-ledger-rationale.md` → "Where
each rule came from".

## The ledger — where an observation that cannot cite a blockage goes

**An observation the depth test turns away is recorded in the ledger, not discarded.**
Rationale: `docs/maintainers/observation-ledger-rationale.md` → "Why the
ledger exists".

- **The destination is the `.josh/observations/` directory in the repository the
  observation is about** — the same repository the Issue would have been filed into — **one file per
  issue**: append to `<N>.md` for the issue the run is executing (the number
  its branch leads with, a lane's included), or to `<YYYY-MM-DD>.md` for a line written on the
  default branch outside any issue's run. Parallel lanes therefore write different files, and their
  pull requests never conflict on the ledger. **The count and the append are both run in that
  repository's checkout** — in this repository, the work tree the run is in, a lane's inside a lane —
  resolved the way `target-repository.md` resolves any cross-repository target, and the
  directory is created on the first append where that repository has none. **The subject decides, never the
  working directory**: an observation about this package's own orchestration, seen while a run is
  inside a repository that consumes it, is recorded here rather than there — the append follows the
  subject, never the working directory. **A third-party target gets no line either** — Tier C covers
  the ledger exactly as it covers the Issue that would otherwise have been filed there.
- **It is append-only.** A line is never edited and never deleted, because the count of lines
  carrying one key is what says whether an observation has recurred; a second sighting is a second
  line, not a rewrite of the first. **A merge conflict in it is resolved by keeping both sides** —
  one file per issue should keep it from arising, but a repeated key is the whole signal, so
  dropping either side destroys exactly what the ledger is for.
- **The completion report keeps its line too.** The ledger is what the next run can read; the report
  is what this run's reader sees. Neither replaces the other.
- **The append is not the end of it** — a line only becomes readable to anyone else once it has
  merged, and "The commit path" below is how it gets there.

**One observation is one line: five fields, each separated from the next by a vertical bar with one
space on either side.**

```
- k:<slug> | d<n> | <YYYY-MM-DD> | <where> | <what>
```

| Field          | What it holds                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `k:<slug>`     | The identity key — lowercase letters and digits, in words joined by `-`. This is what makes a repeat machine-readable      |
| `d<n>`         | The depth of the subject — `d1`, `d2`, or whatever deeper depth `observation-filing.md`'s depth table may one day name. **There is no `d0` line**: a depth-0 observation is filed outright and never reaches the ledger |
| `<YYYY-MM-DD>` | The date of **this** sighting                                                                                             |
| `<where>`      | One file path or one command — where the thing was seen                                                                   |
| `<what>`       | The phenomenon, one sentence, carrying no vertical bar of its own                                                         |

A sample, in the shape a real entry takes:

```
- k:example | d1 | 2026-09-10 | pnpm josh run:progress | The report printed a fill-in placeholder where a clock time belonged
```

**`k:example` is reserved for this sample and is never used by a real observation**, so the count
below can be run over the whole ledger without the sample answering for one. **The grammar is defined
here rather than in the ledger** (`docs/maintainers/observation-ledger-rationale.md` → "Why the
ledger exists").

**The identity key is the whole of the repeat test — never a similarity judgement about the prose.**
Choose the key from the phenomenon rather than from the run, then record the sighting with one
command — it counts what the ledger already holds for the key, appends the line and prints the
verdict:

```bash
pnpm josh observation:record <slug> d<n> '<where>' '<what>' [--checkout <that repository's checkout>]
```

Standard output is one token: `file` (this is the second sighting — file it, below) or `ledger` (the
line is the record, nothing to file); standard error lists the earlier sightings and the file
appended to. A line that breaks the grammar, or uses `k:example`, is refused with exit 1 and nothing
appended. **Every
file of the directory is counted**, in the named checkout rather than the working directory, because
a recurrence is a recurrence whichever issue's file each sighting sits in; a missing directory is a
first sighting, and the append creates it.

Free-text comparison is what the key exists to replace, so two lines that read alike under different
keys are two observations, and a mis-keyed entry is corrected by appending a correctly-keyed line
rather than by editing the one already written.

**The depth gate is not withdrawn, and this is not a way around it.** An observation that *can* cite
the depth-0 work it stopped is filed exactly as it was before — this route is only for the ones that
could not.

## The commit path — how an appended line reaches the default branch

**An append nobody commits is an append nobody can count.** Rationale:
`docs/maintainers/observation-ledger-rationale.md` → "Why the ledger has a commit path".

- **A run's appended lines ride its own commit.** `pnpm josh git` stages
  `.josh/observations/` with the run's other changes, in the one staging step every entry
  point goes through (`scripts/git/git-staging.ts`), so the lines are reviewed and merged with the
  pull request of the run that recorded them, and the run's CI is the only wait they cost.
  **Record before the commit, not after the merge:** a finding recorded with `pnpm josh review:record`
  before `pnpm josh git -y` is carried; the time while CI runs is for the records that need no CI
  result — filing an observation Issue, drafting the completion report.
- **A line that breaks the grammar is not carried.** The staging step parses
  every file of the ledger first — after moving lines still on an old single-file path — and on a broken line leaves the ledger out of the
  commit and says so; the commit itself goes ahead.
- **A review round that passes after the pull request opened is recorded on the Issue, not in the
  ledger** — `pnpm josh review:record --issue <N> --comment` posts the same `- rf:` lines as a comment
  and appends nothing. That round reads only, so no commit of the run's follows it; a line in the tree
  would be pushed onto the open pull request and its CI would start over. `pnpm josh ship --review`
  does this for a passing round 2. **A round 2 that blocks records in the tree as before** — the fix it
  stops for is pushed anyway and carries the lines. The comment's lines are outside the count
  `pnpm josh review:findings` and the retrospective read.
- **`pnpm josh followup` commits any other line appended after the run's commit onto the pull request,
  before the merge** — the residual path, for an observation recorded between the commit and the
  merge. After the merge gates and before the CI wait, `followup` reads the tree and, **only when the
  ledger holds a pending append**, stages the ledger paths alone, commits them and pushes the branch;
  that push restarts the pull request's CI, and the wait that follows covers it. A broken line refuses
  the merge, because the line would otherwise be lost with the branch. A run whose lines rode its
  commit pays nothing.
- **A lane carries its own lines, in its own pull request.** Its writers
  append to its own tree's `<N>.md`, so the two steps above take them to the default branch exactly as
  they do for a run in the primary checkout. **Nothing is held in the primary checkout for later.**
- **`pnpm josh observations:flush` is left for a line written outside any issue's run** — the
  date-named file a retrospective or a hand append on the default branch writes. It stages the ledger
  and nothing else, commits it on a branch of its own, opens a docs-only pull request, waits on the
  same required checks every other pull request waits on, merges it and returns the checkout to the
  default branch; a single run's `run:tail` runs it after the merge. It refuses off the default branch
  and refuses a working tree holding anything besides the ledger, so a run in progress cannot be
  flushed out from under. **Nothing is committed to the default branch directly.**
- **Nothing to flush is an answer, not a failure.** With the ledger matching the commit it sits on
  the command prints `clean` and exits 0.
- **The count the promotion below reads is a count of the default branch.**

## The second sighting is what files it

**A repeat is the citation**, so the gate has a second way through, and it is counted rather than
judged (rationale: `docs/maintainers/observation-ledger-rationale.md` → "Why a second sighting
files"):

- **On `observation:record` answering `file`, the observation is filed**, at depth 1 or deeper, with
  no depth-0 citation. It answers `file` only when exactly one earlier sighting exists — a higher
  count means the Issue was already opened by the sighting before. The line is appended either way,
  because the ledger stays append-only.
- **The Issue quotes the ledger's own dates — the first sighting's and this one's**, both on the
  command's standard error — so the reader can check the promotion against the file instead of
  taking the run's word for it.
- **Both ceilings still apply**, exactly as `observation-filing.md` states them: the 10-per-run cap counts a promoted
  filing, and the WIP cap still bites, since a promoted observation blocks nothing and is therefore
  still discretionary.

**A third and later sighting appends a line and files nothing more.** The Issue from the second one
is already open, and `pnpm josh issue:scout` is what finds it; the extra lines are evidence for that
Issue, not new ones.

## A user-found bug is recorded by its kind of miss (user-found)

**A user-reported bug is fixed or filed as always; this records the *kind of miss* alongside so the
category never recurs as a first sighting.** The key is the **category of
oversight** — `k:missed-case-worktree` — so a second bug of the same kind counts against the first.
**Depth `d1`, never `d0`**: the *kind of miss* is what a run fails to enumerate, which the table puts
at depth 1. Nothing else changes; the `<what>` field leads with `User-reported:`, and no second
ledger, format or threshold is added.
