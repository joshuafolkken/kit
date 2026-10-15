# The observation filing procedure

**Read when an observation turns up — not at the entry.** `SKILL.md` → §2's table points here. **An
observation the depth test turns away, and the kind of miss behind a user-reported bug, are recorded by
`observation-ledger.md` — read it only then**, in the turn that appends.

**An unattended run files without asking; an interactive session asks first.** Unattended means a
`claude -p` session (a lane child, a woken session), a dispatched lane child, or the `backlogrun`
parent; the `Stop` hook sends an offer to file back. Interactively, propose the Issue and file it
once the user confirms. A current-turn instruction to file, or a typed command whose procedure files (a
split, a prerequisite, an upstream interrupt), is that confirmation already.

**The trigger is the judgement, not the run's progress** — an ended run, a `kickoff` and a mid-talk
turn all file or propose.

**An unattended run that judges something worth filing files it, and does not ask.** An ordinary
observation carries no `route:` label, causes no stash or park, and the run continues (unlike an
upstream defect, a split or a prerequisite — `prerequisite.md`). First-party target: Tier A, by
`pnpm josh repo:party`; third-party: Tier C (`CLAUDE.md`). Name what was filed in the completion
report. Drop an observation nobody would act on.

**Below the filing bar, a line that could still change a person's judgement is a board note**:
`pnpm josh run:event --append note "#<N> <text>"`, shown by `pnpm josh run:board`
(`docs/josh-commands-run.md` → "`josh run:board`").

**The filing ceilings still apply.** Count it in the run's ten-Issue limit; above the target
repository's WIP cap, close one first or do not file (`prompts/collaboration-workflow/wip-cap.md`).
File with `pnpm josh issue:file` (`issue-scout.md`): it lints the body, applies the classification
labels, scans for duplicates and runs `epic:bundle` (an `auto-ok` epic adds it to the backlog pool —
`backlogrun-steps.md` → "What one invocation approves"). On the second filing of the run it asks the fold
question and holds a `fold` (`split-assessment.md` → "The same two questions decide the filing-time fold").

### The depth test — a discretionary filing cites the product work it blocked

**Depth is read off the subject rather than judged:**

| Depth | The subject | Where it lives |
| --- | --- | --- |
| **0** | What a consumer of this package touches | A `josh` command's behavior, a distributed document or config, the published package |
| **1** | The run orchestration that executes an Issue | `fullrun` / `backlogrun`, lanes, the `epic:*` commands, the filing routes themselves |
| **2** | What measures a run | `josh cost` and the run-timing report |

**The depth is recorded on the Issue as a label, and the label is applied when the Issue is filed.**
`depth:0` / `depth:1` / `depth:2` are defined in `scripts/issue/issue-labels.ts` with no definition of
their own — **the table above is the single source**. **Every filing route applies one**: each route
of `prerequisite.md`'s table, a split child and a review branch-2 filing pass `--depth <n>` to
`pnpm josh issue:file`, beside any `--route`.

```bash
pnpm josh issue:file "<title>" --body-file <body-file> --depth 1
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=depth:1'   # an Issue already filed
```

`issue:file` creates any missing workflow label from `DEPTH_LABELS` before the create call.

- **It is read off the subject, exactly as the table is** — not a judgement, unlike `auto-ok` and
  `needs-human-review`; it withholds nothing.
- **Applied at filing, not at completion.**
- **An Issue carrying more than one counts as the lowest depth present.**
- **An `epic` takes no depth label** and is excluded from the share's denominator.

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why the depth label is applied at filing".

- **A discretionary observation at depth 1 or deeper is filed only where it can cite the depth-0 work
  it stopped or delayed** — an Issue number or a run, never "this would slow runs down". **Cannot cite
  one, it is not filed**: it goes to the ledger (`observation-ledger.md`); the blockage arriving or a
  second sighting files it later.
- **A depth-0 observation does not take this test**; the two ceilings are its only limits.
- **`route:tier-a` and `route:interrupt` do not take it either**, at any depth.
- **A depth-2 filing also states, on top of the depth-0 citation:**
  - **The decision the number would change, named** — the Issue holding the choice, or a decision a
    person is about to make. "Slow", "large" and "worth knowing" are not a decision.
  - **Which way it tips** — what range of the number selects which choice.
  - **Cannot write both, it is not filed** — it goes to the ledger.
- **This narrows depth 2 alone, and the exemptions above carry over unchanged.**

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why depth gates a discretionary filing".

**It governs this route only — the fourth row of `prerequisite.md`'s table.** A review finding routed
to branch 2 of `prompts/review.md` → "Review round cap" is filed under that section's own bar and
**does not take the depth test**. **That bar is the reason, and the subject's depth is not.**
Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why a review branch-2 filing skips the depth test".

**And a PR that *adds* a measurement names its reader in the same way** — the Issue that read the value
to decide something, or the path of the rule that reads it. **A measurement with no reader is not
added.** `route:tier-a` and `route:interrupt` carry over unchanged.

### The depth-0 share — what is counted

**The depth-0 share is the share of open Issues at depth 0.**

**The denominator is a rule, not a choice, and this is it:**

- **Counted: every open Issue that does not carry `epic`.**
- **`route:tier-a` and `route:interrupt` are counted like anything else.**
- **An Issue with no depth label is in the denominator**, counted separately as `unlabelled`.
- **The numerator is what is left**: open, non-epic Issues carrying `depth:0`.

**Two readings of the same backlog give the same number.**

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why the depth-0 denominator is fixed".

**What the number is for is not decided here** — no `backlog:next` change and no target value until it
has been measured the same way more than once.

### A delegated child does not take this route

**A delegated child files `route:tier-a` and `route:interrupt` only.** Its discretionary observations
go in the summary's "Observations that could bite later" line (`backlogrun-child.md` → "What the
summary carries, and how long it may be"); the parent files what survives the depth test, inside the
run's ceiling.

**A delegated child does not append to the ledger either — the parent collapses the duplicates and
appends what is left.** **The 10-per-run ceiling for this route is the parent's to count.** **Lines
its own `review:record` and `measure:rerun` write are not this route** — they go to its issue's file in
its lane (`observation-ledger.md` → "The ledger — where an observation that cannot cite a blockage goes").

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why a delegated child neither files nor appends".

**This file is the single source of every procedure above**; nothing under
`prompts/collaboration-workflow/` restates it.

Provenance: `docs/maintainers/observation-filing-rationale.md` → "Where each rule came from".
