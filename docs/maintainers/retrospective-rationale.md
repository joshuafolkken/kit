# Retrospective — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/retrospective.md`: why the
procedure is read where it is, why it files two improvements, and where its rules came from. It is
never read during a run — every step, command and bound an agent acts on stays in the procedure
document, and a change to this file changes no rule.

## Why the retrospective is read at its step

**None of it binds until a run has actually drained its backlog**, so it is read when `run:step` prints
the retrospective step rather than at the entry: a run that never empties its pool never reads it, and
the one that does reads it in full before it files.

**When it fires lives in `run:step`'s state transitions rather than in prose**, which is `CLAUDE.md`'s
run-driver rule; the procedure is reached only once the step is already owed. Because `run:step` prints
the step only in the kit repository, a consumer run never reaches the procedure.

## Why the top two are a selection, not a ration

Filing the top two is a selection, not the count cap the depth test rejected
(`observation-filing-rationale.md` → "Why depth gates a discretionary filing"): nothing that passed the
test is lost, because the third onward is stacked in the observation ledger. So "two" is the amount
one turn hands the next run, not a ceiling on what may be recorded.

**Filing nothing when nothing passes is what makes the "file → drain → file again" loop converge.**

## Where each rule came from

- The procedure is read at the retrospective step, not at the entry — joshuafolkken/kit#2328.
- The step fires at the backlog drain, before the idle watch, so the watch picks up what it files —
  joshuafolkken/kit#2335.
- The close writes one `retrospective` event carrying the required `--summary` —
  joshuafolkken/kit#2342.
