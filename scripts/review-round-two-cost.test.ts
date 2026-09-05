import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1305: epic #1222 merged two measures aimed at the review — joshuafolkken/kit#1219
// redefined the second round's question, joshuafolkken/kit#1241 fixed the mechanism that carries that
// question into the forked review agent — and the `review` phase's wall clock did not move. Measuring
// merged runs with `pnpm josh time` found no support for the assumption both rest on, that a round's
// cost follows the size of what it is asked to read.
//
// **This comment states no figure, and that is deliberate.** The canonical section owns them, and a
// number copied here would be updated by nobody: a re-measurement moves `prompts/review.md` and the
// markers below with it, while a copy in a comment stays green at the retired value — the same
// staleness the `DIAG_FORBIDDEN_FIGURES` suite exists to prevent one file further along. It states
// no verdict either, for the same reason the section stops short of one: at its sample the result
// rules out a strong relationship rather than a real one, so a further proposal is asked to say why
// the data does not reach it, not refused.
//
// The conclusion is pinned rather than left as prose because its whole job is to survive until the
// next reader asks the same question. Un-pinned, it is the kind of paragraph a later trim deletes
// for being a digression — and the proposal it qualifies is then re-derived from the same tables,
// which is exactly the loop that produced #1305.
const REVIEW_PROMPT = 'prompts/review.md'
const DIAG_SKILL = '.claude/skills/diag/SKILL.md'
const SECTION_TITLE = 'The narrowing is real in scope and does not show in the wall clock'
// The second half of the same record (joshuafolkken/kit#1418), named once so the canonical heading
// and the pointer that has to reach it cannot drift apart.
const LAYER_SECTION_TITLE =
	'The re-derivation round 2 does is real, and it is not what round 2 costs'

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

// joshuafolkken/kit#1418 asked the next question down: the section above measures the `review`
// phase, and a phase says nothing about what the forked agent inside it spent its turns on. Reading
// 61 round-1/round-2 pairs at that layer found the overlap the proposal assumed — round 2 really
// does re-open most of what round 1 opened — and found that it does not predict what round 2 costs.
//
// **Pinned because the proposal is re-derivable from the overlap alone.** Anyone who opens two
// review transcripts sees the same files in both and reaches for the same handover; only the
// correlation says why it would not pay, and only the sample says why one expensive run is not
// evidence. Both live in the canonical section, and this suite is what keeps them there.
const ROUND_TWO_LAYER_MARKERS: ReadonlyArray<string> = [
	`### ${LAYER_SECTION_TITLE}`,
	// The layer, and that it is the same classifier read finer rather than a second reader — without
	// which the figures below read as a competing measurement of the section above.
	'**joshuafolkken/kit#1418 opened the layer the section above never did.**',
	'**They agree, which is why this refines the section above instead of replacing it**',
	// The sample and its shape. The single-run reading is named as the tail it is, because the whole
	// proposal was filed from that one run.
	'**The pass is cheaper on the median and not reliably, at three times the sample.**',
	'9 of the 61 paid more for round 2 than for round 1',
	'**Run #1399, the run #1418 was filed from, is one of the nine.**',
	// The finding itself: the overlap is real, and it is not the cost. Both halves are needed — the
	// first alone re-opens the proposal, the second alone reads as denying the overlap exists.
	"**Round 2 does re-derive round 1's evidence, and the re-derivation does not predict its cost.**",
	'r = -0.15',
	// The sample travels with the coefficient here for the same reason it does above, and it is
	// pinned present as well as forbidden in the skill: an entry that is only forbidden goes vacuous
	// the moment the canonical wording changes, with both suites still green.
	'n = 61',
	'**What predicts the span is the turn count**',
	'r = +0.80',
	// The correctness objection, which stands whatever the wall clock says.
	'**A handover would carry the retired value in exactly the case it was built for.**',
	// What the brief's instruction half is worth, measured — the thing `review-brief.ts` says must
	// never be assumed.
	'8 of the 61 round-2 agents (13%) still ran a gate check of their own',
	// The limit of the reading, so nobody quotes it as evidence that #1241 worked.
	'**This says what round 2 costs now; it does not say whether joshuafolkken/kit#1241 moved it.**',
	'**The heading above therefore stands unchanged**',
	// The verdict, and the guard that keeps it from becoming a standing refusal.
	"**So handing round 1's derivations to round 2 is not adopted**",
]

describe(`${REVIEW_PROMPT} — the measured dead end is recorded`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each([...CANONICAL_MARKERS, ...ROUND_TWO_LAYER_MARKERS])('states %j', (marker) => {
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
	// The record is two sibling sections, and the pointer named only the first. A `diag` that follows
	// it reaches the phase measurement and never the forked-agent one — which is the half that closes
	// the handover proposal, and the proposal a `diag` re-derives, since two review transcripts
	// visibly open the same files (joshuafolkken/kit#1418).
	'**The record is two sibling sections, and reading only the first one misses half of it**',
	LAYER_SECTION_TITLE,
	// The instruction that keeps the figures single-sourced, which is what the absence suite below
	// enforces mechanically.
	'**Read both before ranking `review`, and quote no figure from either that you have not read there**',
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
//
// **Every entry is a string that occurs verbatim in `prompts/review.md`**, which is the only form a
// copy could take. Guarding a spelling the source does not use protects nothing while reading as
// though it did — so each one below is written exactly as the canonical section writes it, and a
// figure re-worded there is re-worded here in the same edit.
const DIAG_FORBIDDEN_FIGURES: ReadonlyArray<string> = [
	'r = 0.05',
	'±0.65',
	'n = 9',
	'262.5 s',
	'171 s',
	'140 s',
	'136 to 1053',
	'177 to 396',
	// joshuafolkken/kit#1418's figures, guarded on the same rule: the forked-agent layer is the one a
	// `diag` reads next once the phase stops moving, so it is the next place these would be pasted.
	'r = -0.15',
	'r = +0.80',
	'n = 61',
	'9 of the 61',
]

describe(`${DIAG_SKILL} — the ranker is pointed at it`, () => {
	const content = read_unwrapped(DIAG_SKILL)

	it.each(DIAG_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(DIAG_FORBIDDEN_FIGURES)('leaves the figure %j to the single source', (figure) => {
		expect(content).not.toContain(figure)
	})
})
