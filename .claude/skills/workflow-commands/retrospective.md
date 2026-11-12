# The end-of-run retrospective

**When `run:step` prints the retrospective step, the parent runs `pnpm josh run:handoff retrospective`
in the background;** its unit reads this file. `SKILL.md` → §2's table keeps the rule: run the digest
once, file the improvements worth carrying, stack the rest, mark the step done. Read it in full before
filing.

**When it fires is not a judgement.** `run:step` prints the step when `backlog:offer` marks the backlog
drained, *before* the idle watch, so the watch picks up what it files; a run that stops without
draining — the failure guard, `--idle 0` — still prints it at the stop position. Kit-only.

## The digest is read, not skimmed

`run:step`'s digest folds four existing measurements into one — it adds none:

- **Run cost & time by role.** A role whose wall-clock share runs ahead of its cost share is marked
  `waiting-heavy` — a candidate improvement, not a verdict: some roles wait by design.
- **Recurring review findings.** A category that keeps coming back is friction the reviews keep
  catching; the zero-finding denominator separates a quiet category from an unexamined one.
- **Observation ledger.** Observations held without being filed — promote one a second sighting earned.
- **Run events.** The parks, outages, cuts and review rounds — where the run did not run straight through.

The two targets are **the run itself** (sections one, three, four) and **the repository** (section two,
and anything the run surfaced that lives outside it).

Weekly → `pnpm josh hook:ledger --period 7 --demote`.

## What to file — the digest's `Improvement picks`

**The digest ranks the picks and prints the top two's `issue:file` lines; the order is the command's
(`tools/retrospective/retrospective-picks.ts`), not yours.** Write each body citing the pick's evidence
and run its line. A cost regression ranks first and passes as printed — its line names the reproduction.

**Every other pick still faces the depth test** (`observation-filing.md` → "The depth test"): one that
fails it is not filed, and the next pick does not move up. **The `stack:` lines go to the observation
ledger** (drained by `pnpm josh observations:flush`); `Improvement picks: none` files nothing.

**Exclude what is already filed or already done, through the existing scout** (`issue-scout.md`): file
with `pnpm josh issue:file`, which scouts — an **open** candidate covering it means do not file, a
`(closed)` one means already merged. It also runs `epic:bundle` on each new Issue.

## `auto-ok`, and closing the step

**What a retrospective files is judged for `auto-ok`** — one needing no person's judgement declares
`- 人の判断: 不要`, so `issue:file` applies the label (with the run label
`prompts/collaboration-workflow/issue-template.md` requires). **`backlogrun-steps.md` → "What one
invocation approves" is that judgement's single source.** Every brake still counts these filings: the
ten-per-origin ceiling (no-origin filings counted together), the WIP cap, `--max` and the `pnpm josh cost --cut` session budget.

**Close with `pnpm josh run:carry --retrospective --summary "<result>"`.** It marks the
carry record so `run:step` prints `stop` from then on; the mark survives a session cut and is removed at
`pnpm josh run:carry --end`, so one invocation runs it exactly once. **`--summary` is required** — it is
written as a `retrospective` event, so a zero-filing retrospective differs from one that never ran; name
the issues filed (or none) and the candidates dropped with why.

**A dispatched lane child never reaches any of this** — the batch runs it at its own end; `run:step`
answers a lane child `stop` there.
