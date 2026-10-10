# Into-target suffix — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/into-target.md`: the reasons
and history behind the `into <target>` suffix. It is never read during a run — every rule and refusal an
agent acts on stays in the procedure document, and a change to this file changes no rule.

## Why the suffix reads as it does

**Read at the point of use** (joshuafolkken/kit#2161). A run given a `#N` or a bare `new` never reaches
the suffix, so it costs a workflow entry nothing to leave the definition out of the entry read.

**Why `into` is the spelling.** The alternatives collide with forms that already mean something else:
`kickoff new #<E>` reads as the existing `kickoff #N`, and `kickoff new epic #<E>` reads as "create a
new epic" when what gets created is often a single Issue.

**Why the insertion happens as soon as the artifact exists.** Left until the end, a run that stops
halfway leaves behind exactly the orphaned Issue the suffix exists to prevent.

**Why a run never promotes a non-epic target on its own.** Which arm of the refusal applies depends on
what the target is, and promoting rewrites someone else's Issue into a container.

**Why `epic:bundle` still runs.** `epic:bundle` and `into` are separate routes — one a recommendation on
a weak or strong signal, the other a person's explicit choice — so neither replaces the other.
