import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1305: epic #1222 merged two measures aimed at the review — joshuafolkken/kit#1219
// redefined the second round's question, joshuafolkken/kit#1241 fixed the mechanism that carries that
// question into the forked review agent — and the `review` phase's wall clock did not move. Measuring
// 20 merged runs with `pnpm josh time` says why: the phase *is* the agent's two invocations, and
// round 1's duration is uncorrelated with the size of the diff it reads (r = 0.05 across a 7.7×
// range). So narrowing what a round reads is ruled out as a speed measure by measurement.
//
// The conclusion is pinned rather than left as prose because its whole job is to survive until the
// next reader asks the same question. Un-pinned, it is the kind of paragraph a later trim deletes
// for being a digression — and the proposal it rules out is then re-derived from the same tables,
// which is exactly the loop that produced #1305.
const REVIEW_PROMPT = 'prompts/review.md'
const DIAG_SKILL = '.claude/skills/diag/SKILL.md'
const SECTION_TITLE = 'The narrowing is real in scope and does not show in the wall clock'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_TITLE}`,
	// The distinction the section exists to draw: the convergence note above it is about scope.
	'**Convergence above is a statement about scope, and it is not a statement about cost.**',
	// The two qualifications that keep the section from over-claiming, and which a later trim would
	// take out first because they read as hedging. The phase's contents are a definition — the
	// `code-review` call *is* the marker — so only the per-round split is a finding; and the fixes a
	// round demands are charged to `rework`, which a reader who takes this section at face value
	// would leave out of the ranking entirely.
	'**What the phase contains is a definition, and only the split inside it is a finding.**',
	"**The measurement's own content is the per-round split**",
	"**And a review's cost is not all inside its phase**",
	'**Rank that row too**',
	// The measured claims themselves. Dropping any one leaves a conclusion with no figure under it,
	// which is indistinguishable from an opinion and gets argued with rather than read.
	'**The pass is cheaper on the median and not reliably.**',
	'3 of the 14 two-round runs paid more for round 2 than for round 1',
	"**Round 1's cost tracks its input weakly at best, which is why narrowing buys so little.**",
	'r = 0.05',
	// The sample size travels with the coefficient. At n = 9 the interval is wide enough that the
	// result rules out a strong relationship and not a real one, and a bare `r = 0.05` invites the
	// stronger reading — which is what would refuse a genuinely effective measure.
	'**State the sample with the coefficient: at n = 9 that carries a 95% interval of roughly ±0.65**',
	'**A larger sample is exactly what would overturn this**',
	'**So a rewrite of what either round reads is not, on this evidence, a speed measure.**',
	// The escalation guard: the record raises the bar on a further proposal, it does not close the
	// question. Without this the section reads as a standing prohibition.
	'**A third such proposal is not forbidden; it is asked to say why this data does not apply to it**',
	// The two merged measures are named, so the note reads as a verdict on specific work rather than
	// as a general discouragement — and so nobody reads it as saying they were wasted.
	'joshuafolkken/kit#1219',
	'joshuafolkken/kit#1241',
	// A speed proposal assumes the second round is what a run pays for; the distribution says a
	// third of runs never reach one, and that those runs still pay a full round 1. The spread is
	// pinned beside it because "one whole round 1" invites reading round 1 as a constant, and it is
	// not one.
	'6 of the 20 runs finished in one round',
	'**Round 1 is not a constant**',
]

describe(`${REVIEW_PROMPT} — the measured dead end is recorded`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// `diag` is where the proposal would be re-derived: it ranks phases off `pnpm josh time`'s tables and
// has no record of what an earlier one concluded, so the largest phase invites a proposal every time
// it is measured. The skill carries the trigger and a pointer and **no figure at all** — a number
// copied here is the clone `CLAUDE.md` prohibits, and worse than a clone in one specific way: only
// the marker in `CANONICAL_MARKERS` above moves when the measurement is re-taken, so a duplicate
// here would go stale with the suite still green.
const DIAG_MARKERS: ReadonlyArray<string> = [
	'**A phase whose earlier measurement is recorded is ranked against that record, not from the tables alone**',
	'**`review` is the phase that has such a record**',
	SECTION_TITLE,
	// The instruction that keeps the figures single-sourced, which is what the absence suite below
	// enforces mechanically.
	'**Read it before ranking `review`, and quote no figure from it that you have not read there**',
	// The record raises the bar on a further proposal rather than closing the question. Without this
	// the pointer reads as a standing refusal, which would turn a thin correlation into a veto.
	'**A proposal it already covers is not forbidden: it is required to say why the recorded data does not reach it**',
	// Without this the note reads as "drop the row", which would hide the largest phase of a run.
	'**The row still appears in the table either way**',
]

// The figures the canonical section owns, asserted absent from the skill. A prose instruction not to
// copy them is not enforcement — this is. Re-measuring #1305 updates `prompts/review.md` and its
// markers above; if a copy had been left here, the skill would keep quoting the retired number with
// nothing failing.
const DIAG_FORBIDDEN_FIGURES: ReadonlyArray<string> = ['r = 0.05', '262.5', '7.7×', 'n = 9']

describe(`${DIAG_SKILL} — the ranker is pointed at it`, () => {
	const content = read_unwrapped(DIAG_SKILL)

	it.each(DIAG_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(DIAG_FORBIDDEN_FIGURES)('leaves the figure %j to the single source', (figure) => {
		expect(content).not.toContain(figure)
	})
})
