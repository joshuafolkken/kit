# Observation filing — rationale

Rationale behind `.claude/skills/workflow-commands/observation-filing.md`; the ledger's is in
`observation-ledger-rationale.md`.

## Why depth gates a discretionary filing

**A run that has just spent an hour inside the workflow tooling files findings about the workflow
tooling** (joshuafolkken/kit#1698). Measured on the `backlogrun` of 2026-09-09: 5 Issues shipped and
15 filed, of which 13 were discretionary — and all 20 were about this package's own run
orchestration or the tools that measure it, with not one change a consumer of the package would see.
**A listing that measures itself has no natural stopping condition**, because every measurement
creates something new to measure. So the condition comes from outside, and **depth is what supplies
it — read off the subject rather than judged**.

**This is not the count cap that was rejected.** A cap is rationing — past the number the finding is
lost, and nothing about it says which findings were worth having. The depth test changes what counts
as a finding at all, so what it excludes is excluded for a reason a reader can check.

**Why depth 2 carries a further requirement** (joshuafolkken/kit#1975). The citation the depth-0 gate
asks for is one a slow run can always produce, so it barely bites on a measurement Issue: "runs are
slow" and "the diff is large" both name depth-0 work, while the number the Issue proposes to produce
changes nothing — and a listing that measures itself has no natural stopping condition precisely there.

**Why a PR that adds a measurement names its reader.** It is joshuafolkken/kit#2012's test, the one
that retired every column no decision reads, moved to the moment a column is proposed so the
retirement never has to be filed again.

## Why the depth is no longer recorded as a label

The `depth:*` labels existed only to make the depth-0 share countable (joshuafolkken/kit#1729). The
command that counted it was removed in joshuafolkken/kit#1928, and nothing read a label after that,
so the labels and the `--depth` flag went too (joshuafolkken/kit#4108). The depth test itself stays: it
decides whether a discretionary observation is filed, and that reading needs no label.

## Why a review branch-2 filing skips the depth test

**That bar is the reason, and the subject's depth is not** — the sentence in the procedure used to say
that a defect in a `josh` command's behavior is depth 0 by construction, and joshuafolkken/kit#1694
and joshuafolkken/kit#1703 are both branch-2 filings whose subject is the epic tooling, which the depth
table puts at depth 1 (joshuafolkken/kit#1675).

## Why a delegated child neither files nor appends

**The ledger's whole value is that one key means one phenomenon**, and a child holding one Issue's
worth of context cannot tell its observation from the sibling lane's: eight children appending in
parallel would write the same thing under eight keys, and every one of them would then read as a
first sighting.

**Two reasons, and a child can solve neither for itself.** It holds one Issue's worth of context, so
**it cannot tell its observation from the one a sibling filed twenty minutes earlier** — the 15
filings of 2026-09-09 were collapsed to 12 within that same day, which means they were collapsible
at the moment they were made. And **a run's sprawl is the parent's to count**: six children filing
two or three each stay far under their own ten-per-origin ceilings, which is why the filing ceiling
did not fire once on the run that filed fifteen.

## Where each rule came from

- The procedure moved out of the entry into its own file, read when an observation turns up —
  joshuafolkken/kit#1797; nothing under `prompts/collaboration-workflow/` restates it —
  joshuafolkken/kit#1649, joshuafolkken/kit#1797.
- The ledger and the user-reported-bug record split out to `observation-ledger.md`, and `issue:file`
  provisions missing workflow labels itself — joshuafolkken/kit#3176.
- The `Stop` hook sends an unattended run's filing offer back — joshuafolkken/kit#2422.
- The depth table and the depth-0 share as a target — joshuafolkken/kit#1698.
- The depth label applied at filing, and the fixed depth-0 denominator — joshuafolkken/kit#1729;
  both retired with the labels — joshuafolkken/kit#4108.
- The further requirement on a depth-2 filing — joshuafolkken/kit#1975.
- A PR that adds a measurement names its reader — joshuafolkken/kit#2012.
