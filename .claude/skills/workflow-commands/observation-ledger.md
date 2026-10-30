# The observation ledger — grammar, commit path and promotion

**Read only when the depth test in `observation-filing.md` turns an observation away, or a user
reports a bug** (its kind of miss, below), in the turn that appends the line.

## The ledger — where an observation that cannot cite a blockage goes

**An observation the depth test turns away is recorded in the ledger, not discarded.**

- **The destination is the `.josh/observations/` directory in the repository the observation is
  about**, **one file per issue**: `<N>.md` for the issue the run is executing (its branch's number,
  a lane's included), or `<YYYY-MM-DD>.md` on the default branch outside any issue's run. **The count
  and the append are both run in that repository's checkout** (resolved as `target-repository.md`
  resolves a target). **The subject decides, never the working directory.** **A third-party target
  gets no line either** (Tier C).
- **It is append-only.** Never edit or delete a line; a second sighting is a second line. **A merge
  conflict in it is resolved by keeping both sides.**
- **The completion report keeps its line too.**
- **The append is not the end of it** — → "The commit path — how an appended line reaches the
  default branch" below.

**One observation is one line: five fields, each separated from the next by a vertical bar with one
space on either side.**

```
- k:<slug> | d<n> | <YYYY-MM-DD> | <where> | <what>
```

| Field          | What it holds                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `k:<slug>`     | The identity key — lowercase letters and digits, in words joined by `-`                                                    |
| `d<n>`         | The depth of the subject — `d1`, `d2`, or deeper. **There is no `d0` line**: depth 0 is filed outright                     |
| `<YYYY-MM-DD>` | The date of **this** sighting                                                                                             |
| `<where>`      | One file path or one command — where the thing was seen                                                                   |
| `<what>`       | The phenomenon, one sentence, carrying no vertical bar of its own                                                         |

```
- k:example | d1 | 2026-09-10 | pnpm josh run:progress | The report printed a fill-in placeholder where a clock time belonged
```

**`k:example` is reserved for this sample and is never used by a real observation.**

**The identity key is the whole of the repeat test — never a similarity judgement about the prose.**
Choose it from the phenomenon, not the run, and record with one command:

```bash
pnpm josh observation:record <slug> d<n> '<where>' '<what>' [--checkout <that repository's checkout>]
```

Standard output is one token: `file` (second sighting — file it, below) or `ledger` (nothing to file);
standard error lists earlier sightings and the file appended to. A broken line, or `k:example`, exits
1 with nothing appended. **Every file of the directory is counted**, in the named checkout. A
mis-keyed entry is corrected by appending a correctly-keyed line.

**The depth gate is not withdrawn, and this is not a way around it** — an observation that *can* cite
blocked depth-0 work is filed as before.

## The commit path — how an appended line reaches the default branch

**An append nobody commits is an append nobody can count.**

- **A run's appended lines ride its own commit** — `pnpm josh git` stages `.josh/observations/`
  (`scripts/git/git-staging.ts`). **Record before the commit, not after the merge:** a finding recorded
  with `pnpm josh review:record` before `pnpm josh git -y` is carried.
- **A line that breaks the grammar is not carried** — the ledger is left out of the commit, which
  goes ahead.
- **A review round that passes after the pull request opened is recorded on the Issue, not in the
  ledger** — `pnpm josh review:record --issue <N> --comment` (`pnpm josh ship --review` does this for a
  passing round 2), so CI does not restart; so does any code round on a pushed, clean tree, a
  blocking round 2 included.
  Once the Issue closes, the next ledger round outside a lane carries the comment's lines into
  `<N>-comment-rounds.md` (`review-comment-round.ts`); a lane, including one without a child marker, leaves that to
  `pnpm josh observations:flush`.
- **`pnpm josh followup` commits any other line appended after the run's commit onto the pull request,
  before the merge** — only when the ledger holds a pending append; a broken line refuses the merge.
- **A lane carries its own lines, in its own pull request.**
  **Nothing is held in the primary checkout for later.**
- **`pnpm josh observations:flush` is left for a line written outside any issue's run**: it commits the
  ledger alone on its own branch, opens a docs-only pull request, waits on the required checks, merges
  and returns to the default branch (a single run's `run:tail` runs it). It refuses off the default
  branch or with anything besides the ledger in the tree. **Nothing is committed to the default branch
  directly.**
- **Nothing to flush is an answer, not a failure** — `clean`, exit 0.
- **The count the promotion below reads is a count of the default branch.**

## The second sighting is what files it

**A repeat is the citation** — counted, not judged:

- **On `observation:record` answering `file`, the observation is filed**, at depth 1 or deeper, with
  no depth-0 citation (only when exactly one earlier sighting exists).
- **The Issue quotes the ledger's own dates — the first sighting's and this one's.**
- **Both ceilings still apply** (`observation-filing.md`): the per-origin filing cap and the WIP cap.

**A third and later sighting appends a line and files nothing more** — `pnpm josh issue:scout` finds
the open Issue.

## A user-found bug is recorded by its kind of miss (user-found)

**A user-reported bug is fixed or filed as always; this records the *kind of miss* alongside so the
category never recurs as a first sighting.** The key is the **category of oversight** —
`k:missed-case-worktree`. **Depth `d1`, never `d0`**. The `<what>` field leads with `User-reported:`;
nothing else changes.
