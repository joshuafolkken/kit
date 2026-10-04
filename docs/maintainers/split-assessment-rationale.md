# Split assessment — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/split-assessment.md`. It is
never read during a run — the two questions, the size guide and what each entry point does with the
answer stay in the procedure document, and a change to this file changes no rule.

## Why the default is not to split

**The rules were manufacturing Issues faster than runs could close them.** Execution was never the
bottleneck; arrival was, and this assessment was one of the routes producing it: `route:split`
accounted for **28 of the 119 open Issues (24%)**.

**Separability is not scarce, which is why a test made only of it splits nearly everything.** Almost
any request can be described as several deliverables that could each ship alone, so the old test bit on
requests worth a handful of lines. The second question is what makes the test bite only where one Issue
would genuinely be unverifiable in one pass. The review round cap's default and the WIP cap changed
alongside it, in one commit.

## Why diff size is not a reason to split

Splitting an Issue in two to shorten review round 1 lengthens it, because each Issue pays round 1's
fixed cost again while the size-dependent part is merely divided between the halves. Measured in
joshuafolkken/kit#1436: round 1's cost is dominated by a fixed part that two Issues pay twice, so there
is no diff size at which splitting to cut it pays — which is why a proposal for a threshold that splits
more has to say why that data does not reach it.
