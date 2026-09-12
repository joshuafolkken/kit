# The observation filing procedure — `SKILL.md` §2i's body

**This is `SKILL.md` → §2i's procedure, and it is read when an observation turns up — not at the
entry** (joshuafolkken/kit#1797). §2i keeps the rule itself: file it without asking, apply the depth
test, record what the test turns away, and carry the run on. Everything that decides *how* — the
depth table and its labels, the depth-0 share, the ledger's grammar and commit path, the promotion on
a second sighting, and what a delegated child does instead — is here, because none of it binds until
a run has actually found something worth filing. A `fullrun` that never finds one never reads it, and
the one that does reads it in full, in the same turn, before it files.

**Nothing was deferred and nothing was summarized to buy that.** The text below is §2i's, sentence
for sentence, and every marker suite that pinned one of these sentences now pins it here.

### The depth test — a discretionary filing cites the product work it blocked

**A run that has just spent an hour inside the workflow tooling files findings about the workflow
tooling** (joshuafolkken/kit#1698). Measured on the `backlogrun` of 2026-09-09: 5 Issues shipped and
15 filed, of which 13 were discretionary — and all 20 were about this package's own run
orchestration or the tools that measure it, with not one change a consumer of the package would see.
**A listing that measures itself has no natural stopping condition**, because every measurement
creates something new to measure. So the condition comes from outside, and **depth is what supplies
it — read off the subject rather than judged**:

| Depth | The subject | Where it lives |
| --- | --- | --- |
| **0** | What a consumer of this package touches | A `josh` command's behavior, a distributed document or config, the published package |
| **1** | The run orchestration that executes an Issue | `fullrun` / `epicrun` / `backlogrun`, lanes, the `epic:*` commands, the filing routes themselves |
| **2** | What measures a run | `diag`, `josh time`, `josh eval`, `josh cost`, `josh rule:value` |

**The depth is recorded on the Issue as a label, and the label is applied when the Issue is filed**
(joshuafolkken/kit#1729). `depth:0`, `depth:1` and `depth:2` are the three, defined once in
`scripts/git/issue-labels.ts` and carrying no definition of their own — **the table above is the
single source**, and a label description that paraphrased it would be a second copy of the rule.
**Every filing route applies one**, this route and the other three of §2d's table alike: a `new`
entry point, a `route:tier-a` prerequisite, a `route:interrupt`, a split child and a review round
cap's branch-2 filing all pass through a `gh api … issues` call, and the depth label goes in it
beside whatever `route:` label that call already carries.

```bash
gh api repos/{owner}/{repo}/issues -f title="<title>" -f 'labels[]=depth:1' -f body="<body>"
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=depth:1'   # an Issue already filed
```

**Create the three once per repository**, before the first filing that applies one — REST auto-creates
a missing label with a generated color and no description, and the three lines below are what give
each a stable color a reader can scan a listing by. `DEPTH_LABELS` in `scripts/git/issue-labels.ts`
is the single source of the colors and descriptions, and `scripts/issue-depth-label.test.ts` keys
these lines to it so the two cannot drift.

```bash
gh api repos/{owner}/{repo}/labels -f name=depth:0 -f color=0e8a16 -f description="Depth 0 — what a consumer of this package touches (SKILL.md §2i)" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/labels -f name=depth:1 -f color=fbc02d -f description="Depth 1 — the run orchestration that executes an Issue (SKILL.md §2i)" --silent 2>/dev/null || true
gh api repos/{owner}/{repo}/labels -f name=depth:2 -f color=c5def5 -f description="Depth 2 — what measures a run (SKILL.md §2i)" --silent 2>/dev/null || true
```

- **It is read off the subject, exactly as the table is** — so applying it is not a judgement and not
  a person's to make, which is what separates it from `auto-ok` and `needs-human-review`. Those two
  decide what a run may do; this one records what an Issue is about and withholds nothing.
- **Applied at filing, not at completion.** A depth assigned when the work finishes is assigned by
  whoever happens to close it, and the share below is a question about the *open* backlog — an Issue
  that never carried the label was never in the numerator's reach.
- **An Issue carrying more than one counts as the lowest depth present**, the one closest to the
  consumer. It is a fixed tie-break rather than a preference: without one the same backlog measured
  twice can answer twice, which is the whole defect joshuafolkken/kit#1729 was filed for.
- **An `epic` takes no depth label**, because it has no subject of its own to read one off — its
  children carry the subjects, and the share below excludes it from the denominator for that same
  reason. A depth label present on an Issue the count skips is exactly the ambiguity this section
  exists to remove.

- **A discretionary observation at depth 1 or deeper is filed only where it can cite the depth-0 work
  it stopped or delayed** — named as an Issue number or a run, never as "this would slow runs down".
  **Cannot cite one, it is not filed**: it goes to the ledger below, and what files it later is
  either the blockage arriving or a second sighting of the same thing. Pull rather than push — the
  fix follows the jam or the repeat, never the lone sighting.
- **A depth-0 observation does not take this test.** That is the product, and the two ceilings above
  stay its only limits.
- **`route:tier-a` and `route:interrupt` do not take it either**, at any depth: a filing the run
  cannot proceed without is already citing its own blockage.

**It governs this route only — the fourth row of §2d's table.** A review finding routed to branch 2
of `prompts/review.md` → "Review round cap" is filed under that section's own bar — a confirmed
defect reaching a runtime path, with a written failure scenario — and **does not take the depth
test**: it has already cleared a bar this route has not, so gating it on a citation as well would
drop the one kind of finding both documents agree is never dropped. **That bar is the reason, and the
subject's depth is not** — the sentence here used to say that a defect in a `josh` command's behavior
is depth 0 by construction, and joshuafolkken/kit#1694 and joshuafolkken/kit#1703 are both branch-2
filings whose subject is the epic tooling, which the table above puts at depth 1
(joshuafolkken/kit#1675).

**This is not the count cap that was rejected.** A cap is rationing — past the number the finding is
lost, and nothing about it says which findings were worth having. This changes what counts as a
finding at all, so what it excludes is excluded for a reason a reader can check.

### The depth-0 share — what is counted, and the command that counts it

**joshuafolkken/kit#1698 set a measurable target and left nothing that measures it**
(joshuafolkken/kit#1729). Its acceptance criteria named the share of open Issues at depth 0 — 3/23
≈ 13% on 2026-09-09 — and no Issue recorded a depth, so the only way to obtain the number was to open
every open Issue and classify it by eye. Done again on 2026-09-10 that produced 3/14 ≈ 21%, and the
two figures **are not comparable**: they took different denominators, and neither said which.

```bash
pnpm josh depth:share          # → <depth-0>/<denominator> = <n>% ; alias: josh dsh
pnpm josh depth:share --json   # the same figures as one JSON object
```

**The denominator is a rule, not a choice, and this is it:**

- **Counted: every open Issue that does not carry `epic`.** An epic is a container for other Issues
  rather than a deliverable of its own — counting one counts its children twice, and an epic has no
  subject of its own to read a depth off.
- **`route:tier-a` and `route:interrupt` are counted like anything else.** The depth test above
  exempts them from its *citation* requirement; it never said they are not work. Excluded, a run
  could improve the share by choosing a filing route.
- **An Issue with no depth label is in the denominator**, and the command reports it separately as
  `unlabelled`. Left out, the share would improve every time a filing skipped the label — the one
  direction a measurement must never be able to move on its own.
- **The numerator is what is left**: open, non-epic Issues carrying `depth:0`.

**Two readings of the same backlog give the same number**, which is what the hand counts could not
do: nothing in the path is sampled or judged, and `scripts/issue/issue-depth-share.test.ts` pins it.
**A listing that hit the scan ceiling is reported as capped** rather than presented as the whole, and
a listing that could not be read at all answers `unknown` — never a share of zero, which would be a
measurement invented out of a failed fetch.

**What the number is for is not decided here.** Changing what `backlog:next` offers on the strength
of it, and setting a target value, are both deliberately out of scope until the current value has
been measured the same way more than once (joshuafolkken/kit#1729 → 範囲外).

### The ledger — where an observation that cannot cite a blockage goes

**"Not filed" used to mean "gone", and that is what walked the depth test past itself.** The
completion report was the only place such an observation could land, and a completion report is
read once and then scrolls away — so the next run met the same thing as a first sighting, forever.
joshuafolkken/kit#1726 is the worked case: its own body says the depth test would not have filed it,
and it was filed anyway, because **discarding it was the only alternative on offer**
(joshuafolkken/kit#1728).

- **The destination is `docs/observations.md` in the repository the observation is about** — the same
  repository the Issue would have been filed into. **The count and the append are both run in that
  repository's checkout**, resolved the way §2c resolves any cross-repository target, and the file is
  created on the first append where that repository has none. **The subject decides, never the
  working directory**: an observation about this package's own orchestration, seen while a run is
  inside a repository that consumes it, is recorded here rather than there — the append follows the
  subject, never the working directory. **A third-party target gets no line either** — Tier C covers
  the ledger exactly as it covers the Issue that would otherwise have been filed there.
- **It is append-only.** A line is never edited and never deleted, because the count of lines
  carrying one key is what says whether an observation has recurred; a second sighting is a second
  line, not a rewrite of the first. **A merge conflict in it is resolved by keeping both sides** —
  two lanes appending at once is the ordinary case, and a repeated key is the whole signal, so
  dropping either side destroys exactly what the file is for.
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
| `d<n>`         | The depth of the subject — `d1`, `d2`, or whatever deeper depth the table above may one day name. **There is no `d0` line**: a depth-0 observation is filed outright and never reaches the ledger |
| `<YYYY-MM-DD>` | The date of **this** sighting                                                                                             |
| `<where>`      | One file path or one command — where the thing was seen                                                                   |
| `<what>`       | The phenomenon, one sentence, carrying no vertical bar of its own                                                         |

A sample, in the shape a real entry takes:

```
- k:example | d1 | 2026-09-10 | pnpm josh run:progress | The report printed a fill-in placeholder where a clock time belonged
```

**`k:example` is reserved for this sample and is never used by a real observation**, so the count
below can be run over the whole file without the sample answering for one. **The grammar is defined
here rather than in the ledger** because this skill is distributed to every repository that consumes
the package and `docs/` is not — a rule that named a definition the reader never received would
leave every consumer's ledger shaped by hand.

**The identity key is the whole of the repeat test — never a similarity judgement about the prose.**
Choose the key from the phenomenon rather than from the run, then count what the ledger already holds
for it, in that repository's checkout rather than the working directory. **The `|| true` is not
decoration**: `grep -c` exits non-zero on a count of zero, which is the first-sighting branch and the
common one, so without it the step reads as a failed command wherever an exit status is being
watched. **A missing file is not a count of zero, though** — there `grep` exits 2 and prints no
number at all, so an empty answer means create the ledger, never that this is a first sighting.

```bash
grep -c '^- k:<slug> |' <that repository's checkout>/docs/observations.md || true
```

Free-text comparison is what the key exists to replace, so two lines that read alike under different
keys are two observations, and a mis-keyed entry is corrected by appending a correctly-keyed line
rather than by editing the one already written.

**The depth gate is not withdrawn, and this is not a way around it.** An observation that *can* cite
the depth-0 work it stopped is filed exactly as it was before — this route is only for the ones that
could not, and whose sole previous destination was nothing (joshuafolkken/kit#1698's gate stands
unchanged).

### The commit path — how an appended line reaches the default branch

**An append nobody commits is an append nobody can count** (joshuafolkken/kit#1756). The ledger was
given a destination and no route out of the working tree the line was written in, and **structurally
nobody was going to commit one**: the parent session that appends never runs `pnpm josh git`, a child
runs it inside a lane work tree that cannot see the parent's checkout, and in the primary checkout
`git add -u` swept the line into whatever unrelated pull request that run was opening. Measured on
the day the ledger shipped, `docs/observations.md` had exactly one commit — the one that created
it — and seven lines had never left a working tree. **So the repeat count below was reading a file
that is empty on every other machine**, and every sighting was a first one, which is the state
joshuafolkken/kit#1728 created the ledger to end.

- **An ordinary run never commits the ledger, and that is enforced rather than remembered.**
  `pnpm josh git` stages with `docs/observations.md` excluded, in the one staging step every entry
  point goes through (`scripts/git/git-staging.ts`), so a `fullrun` in the primary checkout **cannot**
  carry a ledger line into an Issue that has nothing to do with it. It is not a rule a run has to
  remember at the commit — a run that had to would be the run that forgets.
- **The parent flushes the ledger as a pull request of its own** — `pnpm josh observations:flush`. It
  stages that one path and nothing else, commits it on a branch of its own, opens a docs-only pull
  request, waits on the same required checks every other pull request waits on, merges it and returns
  the checkout to the default branch. **Nothing is committed to the default branch directly**, which
  is the constraint this route had to satisfy.
- **`pnpm josh followup` runs the flush itself, so no run has to remember to** (joshuafolkken/kit#1810).
  The flush is the ledger's only commit path, and until it was wired into `followup` nothing called
  it — an appended line stayed in the working tree until a person ran the command by hand, the same
  "a run that had to remember is the run that forgets" defect the staging exclusion above was built to
  avoid, left standing on the commit side. After the merge and before it releases the working-tree
  hold, `followup` reads the tree, and **only when the ledger holds a pending append** returns the
  checkout to the default branch (`pnpm josh ms`) and flushes. A run that appended nothing pays
  nothing, and a lane/worktree child never appends (below), so its checkout is always clean and the
  step is an immediate no-op there. A flush that fails is reported and does not take the merge, the
  epic close or the hold release down with it. **A side effect: on a run that did flush, `followup`
  ends on the default branch** — the procedure's own `pnpm josh ms` is idempotent, so nothing
  downstream changes.
- **Mixing the lines into a child's pull request was considered and is refused.** That is the
  contamination the exclusion above exists to end, and adopting it would turn the defect into the
  specification: a ledger line in an unrelated diff is a line no reviewer of that diff has a reason
  to question.
- **Run by hand it goes in the primary checkout, once per cycle rather than once per observation** —
  but with `pnpm josh followup` now flushing automatically (above), a hand run is the exception rather
  than the rule. It refuses off the default branch and refuses a working tree holding anything besides
  the ledger, so a run in progress cannot be flushed out from under, and a lane's checkout is never
  the one it acts on.
- **Nothing to flush is an answer, not a failure.** With the ledger matching the commit it sits on
  the command prints `clean` and exits 0 — most cycles append nothing, and a command that errored
  there would be one nobody runs.
- **The count the promotion below reads is a count of the default branch**, which is what this route
  buys: a ledger line that merged is one every later run, every other machine and every fresh clone
  can see, and only then can a second sighting be recognized as one.

### The second sighting is what files it

**A repeat is the citation.** joshuafolkken/kit#1698 asked a discretionary filing to be pulled by a
blockage rather than pushed by a sighting; an observation recorded twice has been pulled — it came
back on its own, which no single sighting can demonstrate. So the gate has a second way through, and
it is counted rather than judged:

- **On the count answering exactly `1`, the observation is filed**, at depth 1 or deeper, with no
  depth-0 citation — `1` and not "1 or more", because a higher count means the Issue was already
  opened by the sighting that answered `1`. The ledger line is appended as well, because the ledger
  stays append-only.
- **The Issue quotes the ledger's own dates — the first sighting's and this one's** — so the reader
  can check the promotion against the file instead of taking the run's word for it.
- **Both ceilings still apply**, exactly as they do above: the 10-per-run cap counts a promoted
  filing, and the WIP cap still bites, since a promoted observation blocks nothing and is therefore
  still discretionary.

**A third and later sighting appends a line and files nothing more.** The Issue from the second one
is already open, and `pnpm josh issue:scout` is what finds it; the extra lines are evidence for that
Issue, not new ones.

### A delegated child does not take this route

**A delegated child files `route:tier-a` and `route:interrupt` only.** Its discretionary
observations are not filed by the child at all: they go back in the summary's "Observations that
could bite later" line (`epicrun.md` → "What the summary carries, and how long it may be"), and the
parent files what survives — under the depth test above, and inside the run's ceiling.

**A delegated child does not append to the ledger either — the parent collapses the duplicates and
appends what is left.** The ledger's whole value is that one key means one phenomenon, and a child
holding one Issue's worth of context cannot tell its observation from the sibling lane's: eight
children appending in parallel would write the same thing under eight keys, and every one of them
would then read as a first sighting. The child's route is unchanged and is the only one it has —
the summary's "Observations that could bite later" line — and the parent chooses the key, checks the
count and writes the line.

**Two reasons, and a child can solve neither for itself.** It holds one Issue's worth of context, so
**it cannot tell its observation from the one a sibling filed twenty minutes earlier** — the 15
filings of 2026-09-09 were collapsed to 12 within that same day, which means they were collapsible
at the moment they were made. And **the 10-per-run ceiling for this route is the parent's to
count**: six children counting two or three filings each never reach it, which is why it did not
fire once on the run that filed fifteen.

**This file is the single source of every procedure above**, and `SKILL.md` → §2i is the single
source of the rule they carry out; nothing under `prompts/collaboration-workflow/` restates either
(joshuafolkken/kit#1649, joshuafolkken/kit#1797).

