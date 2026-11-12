# Observation ledger — rationale

Rationale behind `.claude/skills/workflow-commands/observation-ledger.md`.

## Why the ledger exists

**"Not filed" used to mean "gone", and that is what walked the depth test past itself.** The
completion report was the only place such an observation could land, and a completion report is
read once and then scrolls away — so the next run met the same thing as a first sighting, forever.
joshuafolkken/kit#1726 is the worked case: its own body says the depth test would not have filed it,
and it was filed anyway, because **discarding it was the only alternative on offer**
(joshuafolkken/kit#1728).

**The grammar is defined in the procedure rather than in the ledger** because the skill is distributed
to every repository that consumes the package and `docs/` is not — a rule that named a definition the
reader never received would leave every consumer's ledger shaped by hand.

## Why the ledger has a commit path

**An append nobody commits is an append nobody can count** (joshuafolkken/kit#1756). The ledger was
given a destination and no route out of the working tree the line was written in, and **structurally
nobody was going to commit one**: the parent session that appends never runs `pnpm josh git`, a child
runs it inside a lane work tree that cannot see the parent's checkout, and in the primary checkout
`git add -u` swept the line into whatever unrelated pull request that run was opening. Measured on
the day the ledger shipped, `docs/observations.md` (the single-file ledger, since moved under
`docs/maintainers/` by joshuafolkken/kit#2724 and split into a directory by joshuafolkken/kit#2919)
had exactly one commit — the one that created
it — and seven lines had never left a working tree. **So the repeat count was reading a file
that is empty on every other machine**, and every sighting was a first one, which is the state
joshuafolkken/kit#1728 created the ledger to end.

**Why a run's lines ride its own commit.** Until #2763 the ledger was excluded from the staging step
(joshuafolkken/kit#1756) and every run that appended a line paid a second branch, CI wait and merge
after its own — 144 ledger-only pull requests in one month.

**Why a lane carries its own lines.** Lanes once wrote to the primary checkout's single file instead
(joshuafolkken/kit#2419) and a `backlogrun` flushed them all at `run:carry --end`
(joshuafolkken/kit#2492); another run's stash of that checkout took the lines before the flush saw
them, so neither route remains.

**Why a passing second review round is recorded on the Issue.** That round runs after the commit,
beside CI, and reads only, so its line had no commit left to ride: `pnpm josh followup` pushed it onto
the open pull request and the CI started over — six of the fourteen lanes merged on 2026-10-10. Having
the parent collect such lines in the primary checkout was the other candidate, and it needs both
routes the paragraph above removed, so the record leaves the tree instead (joshuafolkken/kit#3645).

**Why an empty flush exits 0.** Most cycles append nothing, and a command that errored there would be
one nobody runs.

**Why the promotion counts the default branch.** That is what the commit path buys: a ledger line
that merged is one every later run, every other machine and every fresh clone can see, and only then
can a second sighting be recognized as one.

## Why a second sighting files

**A repeat is the citation.** joshuafolkken/kit#1698 asked a discretionary filing to be pulled by a
blockage rather than pushed by a sighting; an observation recorded twice has been pulled — it came
back on its own, which no single sighting can demonstrate.

## Who reads a closed issue's ledger file

Measured for joshuafolkken/kit#7336: 2,912 of 8,242 tracked files, 1–2 more per issue.

Every content reader goes through `observation_ledger_home.read`
(`scripts/observations/observation-ledger-home.ts:104`). It takes every file in the working tree's
directory in name order (`:83`, `:100`), with no git call (`:20`).

The one exception is the one-time move of the old single-file ledgers
(`scripts/observations/observation-ledger-migrate.ts`), which reads only those legacy paths.

So no reader skips a closed issue's file today; the table says which ones need it.

| Reader                                                                                                                                                                                 | Needs closed issues' lines                                                                    | Period                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Second-sighting count — `sightings` / `assess` (`scripts/observations/observation-record.ts:70`, `:89`), also via `scripts/followup/followup-failed-tests.ts:113`                      | yes — a sighting counts whichever issue's file it sits in                                     | all history, no window                                                                                                                              |
| `review:findings` (`scripts/review/review-findings-cli.ts:99`)                                                                                                                         | yes — aggregates every `rf:` line                                                             | `--period <days>` (`:61`), default all time (`:25`); filtered by the line's date field (`scripts/review/review-finding-ledger.ts:202`), not by file |
| Commit precondition — `observation_ledger_prepare` (`scripts/observations/observation-ledger-prepare.ts:15`), called from `scripts/git/git-staging.ts:88`                              | validates them, does not use them                                                             | all files                                                                                                                                           |
| Comment-round carry (`scripts/review/review-comment-round.ts:179`)                                                                                                                     | no lines — only whether `<issue>-comment-rounds.md` exists, which is the carried mark (`:22`) | all closed issues                                                                                                                                   |
| Review-record checks — `scripts/review/review-record.ts:64`, `review-record-pinned.ts:79`, `review-interaction.ts:96`, `review-round-one-closure.ts:56`, `review-round-one-skip.ts:27` | no — they ask about the current issue only                                                    | current issue                                                                                                                                       |

Writers and path matchers read no content: `scripts/git/git-staging.ts` (apart from the
precondition above), `scripts/git/stash/stash-push-cli.ts:11`, `scripts/hooks/bash-revert.ts:25`,
`scripts/josh/josh-commands-workflow.ts:166`, and the comment at
`scripts/cases/cases-interaction.ts:117`.

## Retention policy

**Archive, never expire.** The second-sighting count and `review:findings` read all history.

A line deleted after N days would turn a recurrence into a first sighting, the state the ledger
exists to end (joshuafolkken/kit#1728). The file count grows without bound, not the need, so the
fix is the shape:

- Form: a closed issue's `<issue>.md` and `<issue>-comment-rounds.md` lines move, verbatim and in
  name order, into one aggregate file per month of the issue's close (`archive-YYYY-MM.md`). Lines
  keep their date field, so `review:findings --period` answers as before.
- When: on the default branch, by `observations:flush`, which already commits ledger-only changes.
  Never in a lane: parallel lanes writing one shared file conflict, which is why the carry stays off
  lanes (`scripts/review/review-comment-round.ts:22`).
- Pull request wording: flush's body says it adds lines and changes none
  (`scripts/observations/observations-flush.ts:65`). An archive commit needs its own: it moves lines
  and drops none.
- Carried mark: the carry counts an issue as carried when its file exists. The archive must answer
  that too (a carried-issue list, or the carry reading the archive), or every archived issue is
  carried again.
- Default-branch count: the aggregate sits in the same directory, and `read` takes every `.md` file
  there (`scripts/observations/observation-ledger.ts:55`). The count still reads all of the default
  branch's lines (`.claude/skills/workflow-commands/observation-ledger.md:87`).
- Lanes: a lane appends only to its own open issue's file and brings it to the default branch with
  its own pull request (`scripts/observations/observation-ledger-home.ts:13-16`), so the archive
  never touches a file a lane writes.
- Open issues' files and date files stay as they are, since lines can still be appended to them.

## Where each rule came from

- The procedure split out of `observation-filing.md`, read only in the turn that appends —
  joshuafolkken/kit#3176.
- An observation the depth test turns away is recorded rather than discarded — joshuafolkken/kit#1728.
- One file per issue under `.josh/observations/`, a later append committed onto the pull request by
  `followup`, and a lane carrying its own lines — joshuafolkken/kit#2919.
- The ledger's commit path — joshuafolkken/kit#1756; a run's lines ride its own commit —
  joshuafolkken/kit#2763.
- A line that breaks the grammar is not carried — joshuafolkken/kit#2123; lines on an old
  single-file path are moved first — joshuafolkken/kit#2724, joshuafolkken/kit#2919.
- A user-found bug is recorded by its kind of miss — joshuafolkken/kit#2246.
- A closed issue's lines are archived, never expired — joshuafolkken/kit#7336.
