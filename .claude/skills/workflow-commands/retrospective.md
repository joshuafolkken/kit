# The end-of-run retrospective — `SKILL.md` §2j's body

**This is `SKILL.md` → §2j's procedure, and it is read when `run:step` prints the retrospective step —
not at the entry** (joshuafolkken/kit#2328). §2j keeps the rule itself: run what `run:step` prints once,
file the improvements worth carrying into the next run, stack the rest, and mark the step done.
Everything that decides *how* — what the four sections mean, how the top two are chosen rather than
rationed, the exclusions, and the `auto-ok` carve-out that lets the next run pick them up — is here,
because none of it binds until a run has actually drained its backlog. A run that never empties its pool
never reads it; the one that does reads it in full, in the same turn, before it files.

**When it fires is not this file's, and not a judgement.** The run driver prints the step the moment the
backlog drains — `backlog:offer` marks that drain on the event stream and `run:step` fires the
retrospective at it, *before* the idle watch, so the improvement issues it files are what the watch then
picks up (joshuafolkken/kit#2335); a run that stops without draining — the failure guard, `--idle 0` —
still prints it at the stop position. Either way the rule that decides *when* a run acts lives in
`run:step`'s state transitions rather than in prose here, which is `CLAUDE.md`'s run-driver rule. This
file is reached only once the step is already owed. It is kit-only — `run:step` prints the step only in
the kit repository — so a consumer run never reaches this procedure.

## The digest is read, not skimmed

The command `run:step` prints folds four measurements that already exist into one digest — it adds no
new measurement (the observation-filing rule against readerless numbers). Read each section for what it
is for:

- **Run cost & time by role.** A role whose share of the wall clock runs ahead of its share of the cost
  is marked `waiting-heavy` — the run spent that time waiting rather than working. That gap is a
  candidate improvement, not a verdict: a role that waits by design is not a defect.
- **Recurring review findings.** A category that keeps coming back across rounds is friction in the
  code or the rules the reviews keep catching; the zero-finding denominator tells a genuinely quiet
  category apart from one nobody looked at.
- **Observation ledger.** How many observations are already held without being filed — a reminder to
  promote one a second sighting has now earned, rather than a fresh finding.
- **Run events.** The parks, outages, cuts and review rounds the run hit — where it did not run
  straight through.

The digest closes by pointing back here; the two targets it names are **the run itself** (the first,
third and fourth sections) and **the repository** (the second, and anything the run surfaced that lives
outside it).

## What to file, and how the top two are chosen

**The filing condition is the existing depth test, unchanged** — a filing cites the product work it
improves, and a `depth:2` finding names which decision it turns on (`observation-filing.md` → "The depth
test"). An improvement that cannot pass the test is not filed; it is not a shortfall of the two-item
count, it simply is not yet a finding.

**Order what passes by effect, and file the top two.** This is a selection, not a ration
(`observation-filing.md` → "This is not the count cap"): nothing that passed the test is lost, because
**the third onward is stacked in the observation ledger**, on the same append path
`pnpm josh observations:flush` already drains. So "two" is the amount one turn hands the next run, not a
ceiling on what may be recorded. **File nothing when nothing passes** — a run whose measurements show no
improvement worth carrying files zero Issues, and that is what makes the "file → drain → file again"
loop converge.

**Exclude what is already filed or already done, through the existing scout** (`SKILL.md` → §2e). Run
`pnpm josh issue:scout "<title>"` before each `gh api … issues` call: an **open** candidate covering the
same work means do not file it, and a `(closed)` candidate covering it means the work is already merged.
Neither exclusion is a new mechanism. After filing, `pnpm josh epic:bundle <new>` places each Issue, as
after any filing.

## `auto-ok`, and closing the step

**A retrospective may apply `auto-ok` to what it files** — the one path on which a run labels its own
input, so the next run picks the improvements up without waiting for a person. **`backlogrun-steps.md` →
"What one invocation approves" is that carve-out's single source**; it is written there, beside the
brakes that bound it, rather than restated here. Every brake still counts a retrospective's filings: the
ten-per-invocation ceiling, the WIP cap of 30, `--max`, the 150,000-token session budget and the 8-hour
whole-run bound.

**Close with `pnpm josh run:carry --retrospective --summary "<result>" --owner "$PPID"`.** It marks the
retrospective run on the carry record, so `run:step` prints `stop` from then on rather than the step a
second time. The mark rides the record across a session cut and is removed with the record at
`pnpm josh run:carry --end`, so one invocation runs the retrospective exactly once whether or not it was
cut. **`--summary` is required** — the same close writes it as one `retrospective` event on the event
stream (joshuafolkken/kit#2342), so a zero-filing retrospective differs from one that never ran; name
the issues filed (or that none were) and the candidates dropped with why.

**A dispatched lane child never reaches any of this** — the batch runs the retrospective at its own end,
never a child's, exactly as it asks `release:scope` once at the batch's end. `run:step` already answers
`stop` for a lane child at the stop position, so a child never prints the step to begin with.
