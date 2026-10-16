# The end-of-run retrospective

**Read it when `run:step` prints the retrospective step — not at the entry.** `SKILL.md` → §2's table
keeps the rule: run what `run:step` prints once, file the improvements worth carrying, stack the rest,
mark the step done. Read this file in full, in the same turn, before filing.

**When it fires is not a judgement.** `run:step` prints the step when `backlog:offer` marks the backlog
drained, *before* the idle watch, so the watch picks up what it files; a run that stops without
draining — the failure guard, `--idle 0` — still prints it at the stop position. Kit-only.

Rationale: `docs/maintainers/retrospective-rationale.md` → "Why the retrospective is read at its step";
provenance: `docs/maintainers/retrospective-rationale.md` → "Where each rule came from".

## The digest is read, not skimmed

The command `run:step` prints folds four existing measurements into one digest — it adds none:

- **Run cost & time by role.** A role whose wall-clock share runs ahead of its cost share is marked
  `waiting-heavy` — a candidate improvement, not a verdict: some roles wait by design.
- **Recurring review findings.** A category that keeps coming back is friction the reviews keep
  catching; the zero-finding denominator separates a quiet category from an unexamined one.
- **Observation ledger.** Observations held without being filed — promote one a second sighting earned.
- **Run events.** The parks, outages, cuts and review rounds — where the run did not run straight through.

The two targets are **the run itself** (sections one, three, four) and **the repository** (section two,
and anything the run surfaced that lives outside it).

## What to file, and how the top two are chosen

**The filing condition is the existing depth test, unchanged** (`observation-filing.md` → "The depth
test"). What cannot pass it is not filed — not a shortfall, just not yet a finding.

**A cost regression is filed.** The digest's `File a cost regression: …` line passes the depth test as
printed — measured, with the command it names as the reproduction — and ranks first: one Issue names
every regressed row, and the scout keeps a repeat sighting from filing twice.

**Order what passes by effect, and file the top two.** **The third onward is stacked in the observation
ledger** (drained by `pnpm josh observations:flush`). **File nothing when nothing passes.**
`docs/maintainers/retrospective-rationale.md` → "Why the top two are a selection, not a ration".

**Exclude what is already filed or already done, through the existing scout** (`issue-scout.md`): file
with `pnpm josh issue:file`, which scouts first — an **open** candidate covering it means do not file, a
`(closed)` one means already merged. It also runs `epic:bundle` on each new Issue.

## `auto-ok`, and closing the step

**What a retrospective files is judged for `auto-ok`** — one needing no person's judgement declares
`- 人の判断: 不要`, so `issue:file` applies the label (with the run label
`prompts/collaboration-workflow/issue-template.md` requires). **`backlogrun-steps.md` → "What one
invocation approves" is that judgement's single source.** Every brake still counts these filings: the
ten-per-invocation ceiling, the WIP cap, `--max` and the 150,000-token session budget.

**Close with `pnpm josh run:carry --retrospective --summary "<result>" --owner "$PPID"`.** It marks the
carry record so `run:step` prints `stop` from then on; the mark survives a session cut and is removed at
`pnpm josh run:carry --end`, so one invocation runs it exactly once. **`--summary` is required** — it is
written as a `retrospective` event, so a zero-filing retrospective differs from one that never ran; name
the issues filed (or none) and the candidates dropped with why.

**A dispatched lane child never reaches any of this** — the batch runs it at its own end; `run:step`
answers `stop` for a lane child at the stop position.
