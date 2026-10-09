# The observation filing procedure

**Read when an observation turns up — not at the entry.** `SKILL.md` → §2's
table points here for the rule itself: who is asked before a filing, the depth test, what the test
turns away, and carrying the run on. This file is that rule, the depth table, the `issue:file` flags
and what a delegated child does instead. **An observation the depth test turns away, and the kind of miss behind a
user-reported bug, are recorded by `observation-ledger.md` — read it only then**, in the turn that
appends.

**An unattended run files without asking; an interactive session asks first.** Unattended is a session kit launched under `claude -p` (a lane child, a woken session), a dispatched
lane child, or the `backlogrun` parent — nobody is there to answer, so an offer to file is sent back
by the `Stop` hook. In an interactive session, propose the Issue and file it
once the user confirms; the hook lets the offer through. A current-turn instruction to file, and a
typed command whose own procedure files (a split, a prerequisite, an upstream interrupt), are that
confirmation already.

**The trigger is the judgement, not the run's progress** — an ended run, a `kickoff` and a mid-talk
turn all file or propose.

**An unattended run that judges something worth filing files it, and does not ask.** An upstream defect stops the
run, a split replaces it, and a prerequisite goes in front of it (`prerequisite.md`). An ordinary
observation changes none of those: it carries no `route:` label, causes no stash or park, and the run
continues. A first-party target is Tier A, decided by `pnpm josh repo:party`; a third-party target is
Tier C (`CLAUDE.md`). Name what was filed in the completion report. An observation nobody would act
on is dropped rather than filed.

**Below the filing bar, a line that could still change a person's judgement is a board note**:
`pnpm josh run:event --append note "#<N> <text>"`, shown by `pnpm josh run:board`
(`docs/josh-commands-run.md` → "`josh run:board`").

**The filing ceilings still apply.** Count this filing in the ten-Issue limit for the run. An
observation is discretionary, so above the WIP cap in the target repository, close one first or do
not file (`prompts/collaboration-workflow/wip-cap.md`). File it with `pnpm josh issue:file`
(`issue-scout.md`), which lints the body against `prompts/collaboration-workflow/issue-template.md`,
applies the classification labels it declares, runs the duplicate scan, and runs `epic:bundle` on the
new Issue so it is offered by its epic; an `auto-ok` epic adds it to the backlog pool
(`backlogrun-steps.md` → "What one invocation approves"). When it is the second filing of the run, the
command asks the fold question itself and holds a `fold`
(`split-assessment.md` → "The same two questions decide the filing-time fold").

The marker suite pins the rules below.

### The depth test — a discretionary filing cites the product work it blocked

**Depth is read off the subject rather than judged:**

| Depth | The subject | Where it lives |
| --- | --- | --- |
| **0** | What a consumer of this package touches | A `josh` command's behavior, a distributed document or config, the published package |
| **1** | The run orchestration that executes an Issue | `fullrun` / `backlogrun`, lanes, the `epic:*` commands, the filing routes themselves |
| **2** | What measures a run | `josh cost` and the run-timing report |

**The depth is recorded on the Issue as a label, and the label is applied when the Issue is filed.**
`depth:0`, `depth:1` and `depth:2` are the three, defined once in
`scripts/issue/issue-labels.ts` and carrying no definition of their own — **the table above is the
single source**, and a label description that paraphrased it would be a second copy of the rule.
**Every filing route applies one**, this route and the other three of `prerequisite.md`'s table alike: a `new`
entry point, a `route:tier-a` prerequisite, a `route:interrupt`, a split child and a review round
cap's branch-2 filing all pass through a `pnpm josh issue:file` call, and the depth goes in it as
`--depth <n>` beside whatever `--route` that call already carries.

```bash
pnpm josh issue:file "<title>" --body-file <body-file> --depth 1
gh api repos/{owner}/{repo}/issues/<N>/labels -f 'labels[]=depth:1'   # an Issue already filed
```

**A repository missing the three gets them from `issue:file` itself** — it creates any missing
workflow label, with the color and description `DEPTH_LABELS` in `scripts/issue/issue-labels.ts`
defines, before the create call.

- **It is read off the subject, exactly as the table is** — so applying it is not a judgement and not
  a person's to make, which is what separates it from `auto-ok` and `needs-human-review`. Those two
  decide what a run may do (`auto-ok` by `issue:file`'s default for a filing found by opted-in work —
  `backlogrun-steps.md` → "What one invocation approves"); this one records what an Issue is about
  and withholds nothing.
- **Applied at filing, not at completion.**
- **An Issue carrying more than one counts as the lowest depth present**, the one closest to the
  consumer.
- **An `epic` takes no depth label**, because it has no subject of its own to read one off — its
  children carry the subjects, and the share below excludes it from the denominator for that same
  reason.

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why the depth label is applied at filing".

- **A discretionary observation at depth 1 or deeper is filed only where it can cite the depth-0 work
  it stopped or delayed** — named as an Issue number or a run, never as "this would slow runs down".
  **Cannot cite one, it is not filed**: it goes to the ledger (`observation-ledger.md`), and what files it later is
  either the blockage arriving or a second sighting of the same thing. Pull rather than push — the
  fix follows the jam or the repeat, never the lone sighting.
- **A depth-0 observation does not take this test.** That is the product, and the two ceilings above
  stay its only limits.
- **`route:tier-a` and `route:interrupt` do not take it either**, at any depth: a filing the run
  cannot proceed without is already citing its own blockage.
- **A depth-2 filing — one whose subject is what measures a run — carries a further requirement, on
  top of the depth-0 citation above rather than in place of it.** A
  discretionary depth-2 filing states two things the depth-0 citation does not force:
  - **The decision the number would change, named** — the Issue number holding the choice it is
    waiting on, or a decision a person is about to make. "Slow", "large" and "worth knowing" are not a
    decision.
  - **Which way it tips** — what range of the number selects which choice. A number that selects the
    same action whatever it turns out to be changes no decision, and a filing that cannot write this
    line is describing one.
  - **Cannot write both, it is not filed** — the same exit the depth-0 gate takes: the ledger,
    pulled into an Issue by the jam arriving or the second sighting, never pushed by the lone idea.
- **This narrows depth 2 alone, and the exemptions above carry over unchanged.** `route:tier-a` and
  `route:interrupt` do not take this requirement any more than they take the depth-0 citation, a
  depth-0 observation does not take it because it is the product, and a review round cap's branch-2
  filing (below) clears its own bar and never reaches this one.

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why depth gates a discretionary filing".

**It governs this route only — the fourth row of `prerequisite.md`'s table.** A review finding routed to branch 2
of `prompts/review.md` → "Review round cap" is filed under that section's own bar — a confirmed
defect reaching a runtime path, with a written failure scenario — and **does not take the depth
test**: it has already cleared a bar this route has not, so gating it on a citation as well would
drop the one kind of finding both documents agree is never dropped. **That bar is the reason, and the
subject's depth is not.** Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why a
review branch-2 filing skips the depth test".

**And a PR that *adds* a measurement names its reader in the same way.** The requirement above binds
a depth-2 Issue that *proposes* a measurement; a pull request that *adds* one — a new report column,
section, scope or subcommand, a diagnostic step — states in its body the reader that consumes it: the
Issue number that read the value to decide something, or the path of the rule that reads it. **A
measurement with no reader is not added.** `route:tier-a` and
`route:interrupt` carry over unchanged.

### The depth-0 share — what is counted

**The depth-0 share is the share of open Issues at depth 0.**

**The denominator is a rule, not a choice, and this is it:**

- **Counted: every open Issue that does not carry `epic`.**
- **`route:tier-a` and `route:interrupt` are counted like anything else.** The depth test above
  exempts them from its *citation* requirement; it never said they are not work.
- **An Issue with no depth label is in the denominator**, counted separately as `unlabelled`.
- **The numerator is what is left**: open, non-epic Issues carrying `depth:0`.

**Two readings of the same backlog give the same number**: nothing in the count is left to the
counter's judgement.

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why the depth-0 denominator is fixed".

**What the number is for is not decided here.** Changing what `backlog:next` offers on the strength
of it, and setting a target value, are both out of scope until the current value has
been measured the same way more than once.

### A delegated child does not take this route

**A delegated child files `route:tier-a` and `route:interrupt` only.** Its discretionary
observations are not filed by the child at all: they go back in the summary's "Observations that
could bite later" line (`backlogrun-child.md` → "What the summary carries, and how long it may be"), and the
parent files what survives — under the depth test above, and inside the run's ceiling.

**A delegated child does not append to the ledger either — the parent collapses the duplicates and
appends what is left.** The child's only route is the summary's "Observations that could bite later"
line; the parent chooses the key, checks the count and writes the line. **The 10-per-run ceiling for this route is the parent's to
count.** **Lines its own `review:record` and `measure:rerun` write are not this route** — they go to
its issue's file in its lane (`observation-ledger.md` → "The ledger — where an observation that
cannot cite a blockage goes").

Rationale: `docs/maintainers/observation-filing-rationale.md` → "Why a delegated child neither files
nor appends".

**This file is the single source of every procedure above**, and `SKILL.md` → §2's table carries the
trigger of the rule they carry out; nothing under `prompts/collaboration-workflow/` restates either.

Provenance: `docs/maintainers/observation-filing-rationale.md` → "Where each rule came from".
