# Pre-gate cut — rationale

This is maintainer-only rationale behind `.claude/skills/workflow-commands/pre-gate-cut.md`: the
measurements, the history and the arguments that justify the procedure's boundaries, guards and
threshold. It is never read during a run — every trigger, command, verdict and bound an agent acts on
stays in the procedure document, and a change to this file changes no rule.

## Why the cut exists

A lane child's accumulated implementation thinking rides on every later API call in the same session —
measured at **176K of 204K output tokens** on joshuafolkken/kit#1837. The pre-gate boundary is the same
one joshuafolkken/kit#1837 puts the `origin/main` merge at: everything before it produced the thinking to
be dropped, everything after it is verification that needs only the tree.

The rule is reached only **during** a lane child's run, after the workflow skill has been read, so it is
not an entry read — which is why `fullrun.md`, `chain-rule.md` and `backlogrun.md` name it with a plain
mention and route to it rather than loading it at entry. The gate guard's context read is lazy, after
the command and lane checks, so an ordinary run pays nothing for it.

A dispatched child is told apart from a person's interactive `fullrun` by a mark the dispatch sets
rather than by the model reading the shape of its own prompt (joshuafolkken/kit#1904): a person's run
must never relaunch itself, and a judgement from prompt shape is not mechanical. A mark a run could set
for itself would be no mark at all, which is why the run never writes it.

**The implementation-phase cut** (joshuafolkken/kit#1933) exists because the pre-gate cut does nothing
about thinking accumulated _during_ implementation. A lane child re-reads its whole conversation on every
request, so a long implementation is billed like a long `backlogrun` parent, which on 2026-09-13 measured
**208k–386k** median context per request.

## Why the rules are guards, not prose

**The pre-gate cut.** Carried as prose, the step fired exactly never: joshuafolkken/kit#1850 measured
six lane children, and four issued the _entry_ check `pnpm josh run:cut --resume <N>`, were answered
`fresh`, and went to the gate; not one issued the cut — the cut was taken **0 times**. A step a run is free to skip is the step skipped
under time pressure, hence the `rule:guard` refusal of the gate (joshuafolkken/kit#1864). The asking
spellings (`--resume`, `--end`, `--json`) are not counted as the cut because they ask about one rather
than take it — counting them would have credited four of the six measured children. The refusal fires
once per run because five of the six verdicts leave the process holding the run, each needing the
reissued gate call to pass; a repeating refusal would wedge exactly the runs that obeyed.

joshuafolkken/kit#2177 then fixed the order in the chain (`chain-rule.md` step 1) so the default path
takes the cut before anything reads the tree, removing the wasted round trip joshuafolkken/kit#2160
measured — an uncut gate refused, its batched `review:brief` cancelled, then cut and resume. The refusal
became insurance rather than the primary trigger.

**The implementation-phase cut.** joshuafolkken/kit#1933 reasoned it _could not_ be a guard, because the
per-request cost was read asynchronously; but `cost_cli.session_verdict` is synchronous and is the exact
verdict `pnpm josh cost --cut` prints. joshuafolkken/kit#2310 measured the child-side check across five
lanes: the verdict was read once each at session entry, before the context grew, so the cut fired
**0 times** while 33.9% of their requests ran past 200,000 tokens. A `PreToolUse` refusal lands _before_ the edit,
so the tree is at the state the previous edit left.

joshuafolkken/kit#2385 replaced its once-per-run firing: once per run silenced the row after its first
refusal, so a `busy` / `failed` / `unready` verdict, or an edit reissued unchanged, left the context to
grow unwatched — joshuafolkken/kit#2382 ran to 282,747 tokens with the cut never taken. The reissue
window keeps a `busy` / `failed` cut from wedging the run, and the verdict cache exists because the
whole-transcript price became a candidate on every edit.

**The lane-child park.** A headless child's only route to ask a person anything is to park the Issue.
Measured twice on 2026-09-14: #2012's child had its `AskUserQuestion` refused and #2011 wrote a Tier B
decision, both only to their final message, so the parent found an OPEN Issue with `in-progress` and no
question. The child is the only process that knows the question, so it records the park itself. The park
state is a GitHub label and a `PreToolUse` guard makes no network call, so the delivery is a checklist —
one wasted reissue on the compliant path is safe.

**The interactive ask.** The stop-notify guard fired one tool call too late (joshuafolkken/kit#2201): the
harness refuses an interactive ask in a headless session by **ending the turn**, so the notify guard
never fires and the question dies in the exit record's `permission_denials`. Measured on 2026-09-20
inside `backlogrun #2163 --only`: #2178's child hit a Tier B branch, called `AskUserQuestion`, was
refused, and left an OPEN Issue with `in-progress` and no question. A hook deny returns to the model
rather than ending the turn, so refusing the ask one call earlier turns it into an instruction.

## Which suites pin each guard

`scripts/rules/pre-gate-cut.test.ts` pins the pre-gate cut's gate refusal,
`scripts/rules/implementation-cut.test.ts` pins the implementation-phase cut's edit refusal,
`scripts/rules/lane-park.test.ts` pins the lane-child park's notify refusal, and
`scripts/rules/lane-interactive-ask.test.ts` pins the interactive-ask refusal.

## Why the threshold is a break-even

**One statistic, redefined.** joshuafolkken/kit#2295 changed `cost_verdict.per_request_cost` to average
the most recent 10 requests rather than the whole session. It superseded joshuafolkken/kit#2282, which
kept the whole-session average and rejected this option on the batch it measured — short-lived lane
children with no parent session, for which the two averages nearly coincide. The 2026-09-21 parent
`567f8eac` (186 requests, 7 hours) first crossed 200k at request 65, but its whole-session average did
not until request 150 — **85 requests (~4 hours) later**, ~$7.88 supervising an oversized parent past the
point a cut was due. The recent window removes that lag. It is not a forbidden second measurement:
joshuafolkken/kit#1933 forbids the child pricing its cut on a statistic the parent does not share, and
#2295 keeps one statistic both read. Built for a pathological regime a typical lane never enters, the
threshold sits below that regime's 208k floor, so a runaway implementation still trips it.

**Then the newest request.** joshuafolkken/kit#3224 found the ten-request average still trailing: wake
session `03367124` on 2026-10-05 crossed 135k at request 65 and its average at request 70. A session's
billed input only grows between compactions — units write transcripts of their own — so the average
smoothed no outlier and only lagged. The statistic is now the newest request's billed input, the
current context the break-even below is defined on. The rest of that session's climb to 167k came
after its hand-off, from a person continuing to talk to the handed-off session — not a guard defect.

**The value is derived.** joshuafolkken/kit#2374 set 150,000; joshuafolkken/kit#2406 replaced the
hand-picked number with the arithmetic behind it. A cut costs one preamble rewrite (`POST_CUT_CONTEXT`,
~60,000 tokens) and saves the dropped context's cache read on every later request, so it turns on a
rate, not a ceiling: `scripts/cost-runtime/context-cut-payback.ts` computes the per-request context at
which a cut pays back over the expected remaining requests, from the cache multipliers in
`cost-pricing.ts` (no second price list). At a 10-request horizon that is 135,000, inside #2374's band;
the horizon is the knob a before/after lane measurement tunes.

**The resume side is priced.** Until joshuafolkken/kit#2312 the pre-gate cut was unconditional, and its
case recorded only the gain — the context reduction it carries (~130k → ~60k per request). A cut
relaunches a fresh process that re-reads the plan and decisions off GitHub before the gate, a fixed ramp
of ~12 requests per session. That ramp was **$81.01 of $435.09 (19%)** across the 32 lanes of
2026-09-21, falling hardest on the short lanes with the least to drop: #2282 spent 58% of its billing on
it at 60k median context, #2295 39% at 74k, #2289 37% at 81k — each with 0% of its requests over 200k.
A lane like #2298 (31% of requests over 200k) still cuts. An unmeasurable session keeps the old
unconditional cut so it is never left uncut.

## Why the resume carries what it carries

A stopped child used to reconstruct its entry on every resume — 2.6 minutes and ~150K tokens
(joshuafolkken/kit#1876) — so the stage is passed to the resumed child rather than rebuilt by it
(joshuafolkken/kit#1904). The conversation is not carried because joshuafolkken/kit#1567 found
compaction does not reduce billing; the plan and auto-decisions are on GitHub already. The hold is kept
because the uncommitted work is what a second run would trample. The ending checks are batched because
every check is a request too (joshuafolkken/kit#1383).

## Where each rule came from

- A `handed-off` resume, and the spent hand-off that makes a second resume answer it —
  joshuafolkken/kit#1935.
- `pnpm josh run:ending` detecting a child that ended without cutting — joshuafolkken/kit#2139.
- A lane child recording its own park so `run:liveness` reads it `settled` — joshuafolkken/kit#2034,
  after the stops measured on #2012 and #2011.
- The interactive ask refused one call earlier — joshuafolkken/kit#2201, completing
  joshuafolkken/kit#2034, after the ask lost on #2178.
