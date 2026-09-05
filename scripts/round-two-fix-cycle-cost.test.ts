import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1382. joshuafolkken/kit#1261 accepted a stated price — one extra intermediate
// commit, and CI run twice whenever round 2 fixes a finding in place — and joshuafolkken/kit#1403
// built the instrument that reads it. This suite pins the reading and the decision it produced.
//
// **The pinning is what makes the decision auditable rather than re-litigated.** A conclusion of
// "keep the status quo" leaves no artifact behind on its own, so the next reader who measures the
// same phase re-derives the same three proposals from the same tables — which is the loop
// joshuafolkken/kit#1305 was filed out of, one phase further along. Un-pinned, this section is also
// exactly the paragraph a later trim removes for reading as a digression.
//
// **This comment states no figure, on the rule `review-round-two-cost.test.ts` already states**: the
// canonical section owns them, a re-measurement moves that section and the markers below together,
// and a number copied into a comment stays green at the retired value.
const REVIEW_PROMPT = 'prompts/review.md'
const DIAG_SKILL = '.claude/skills/diag/SKILL.md'
const SECTION_TITLE = 'What a round-2 fix-in-place costs, and how often it is paid'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_TITLE}`,
	// What the measurement is about, and which of the three disposition exits pays it. Dropped, the
	// section reads as pricing round 2 itself, which the two records above it already do differently.
	'**joshuafolkken/kit#1261 named the price it was accepting and nobody had measured it**',
	'branch 1 of the disposition below, and the only one of the three that pushes anything',
	// The frequency half of the acceptance condition, and the refusal to convert it into a rate. Both
	// are needed: the counts alone invite a percentage, and the refusal alone reads as no answer.
	'**Three counts, and deliberately no rate.**',
	'**occurred 6 · did not occur 2 · could not tell 12**',
	'**A rate is not quoted, because most of the set could not be classified**',
	'**What the counts do support is that the case is not rare**',
	// The cost half. The lower-bound caveat travels with it, because a total quoted as exact where one
	// component was unattributable is the over-reading the instrument's own rules forbid.
	'**The serial stretch is 42.0 s to 132.8 s, median 100.2 s — 1.9% to 11.1% of its run, median 4.6%**',
	"**#1387's figure is a lower bound**",
	// Why the figure the issue was filed from does not match. Without it the record looks like it
	// contradicts its own parent issue, and the next reader trusts the larger number.
	'**The run joshuafolkken/kit#1382 was filed from is above all six.**',
	// The composition, and that most of it is out of scope by the issue's own terms — which is what
	// makes (c) a reading rather than a shrug.
	'**What the stretch is made of, summed across the six**',
	"**The two largest are both out of scope by joshuafolkken/kit#1382's own terms**",
	// The one observation the reading produced, with its cause explicitly not claimed. Dropping the
	// second half turns a duration into a mechanism, which the skill forbids for these same rows.
	'**The gate component is bimodal, and this reading does not say why.**',
	'**Recorded as an observation, not as a mechanism**',
]

// The decision itself, and the reason each rejected option was rejected. **A recorded choice without
// its rejected alternatives is not a decision record** — the next reader has no way to tell whether
// (b) was weighed or forgotten, and re-proposes it from the issue body.
const DECISION_MARKERS: ReadonlyArray<string> = [
	'**(c) — the status quo — is taken, and (a) and (b) are not.**',
	'**(b) — overlapping the post-merge routine into the second CI wait — has no target in the measurement.**',
	'**five of the six merged before joshuafolkken/kit#1350**',
	"**(a) — reducing how often round 2 produces a commit — already has its lever, and building a second one here is not this document's to do.**",
	'**Its effect on the three counts is unmeasured**',
	// The out-of-scope half restated where the decision is, not only in the issue. A record that keeps
	// the cheap options and loses the prohibition is one a later reading takes the cheap option from.
	'**Cutting the required checks, or merging without waiting for the second cycle, is out of scope and stays so.**',
	// A kept status quo needs a withdrawal condition, or it becomes permanent by default — the same
	// shape "When the condition is withdrawn" gives the skip arms.
	'**What would reopen it.**',
	'**A single run above the range is not that**',
]

describe(`${REVIEW_PROMPT} — the second cycle's price and the decision are recorded`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each([...CANONICAL_MARKERS, ...DECISION_MARKERS])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The skill is where the proposal would be re-derived: its round-2 disposition row prices this exact
// stretch on every `diag`, and it used to say joshuafolkken/kit#1382 could not be decided — true when
// it was written, and false the moment the record above existed.
const DIAG_MARKERS: ReadonlyArray<string> = [
	SECTION_TITLE,
	'**Read that record before proposing a cut here**',
	// The distinction that decides what may be duplicated: one run's own arithmetic is immutable, a
	// distribution over a moving set is not. Without it the next editor either pastes the distribution
	// here or deletes run #1399's worked example, and the row loses its calibration either way.
	'**The distribution stays there and no part of it is copied here**',
]

// **The guard is on the set-level figures, and on those only.** Every entry below is a number the
// canonical section computed *over the set of runs* — the three counts, the median, and the four
// component sums — so re-measuring moves each of them, and a copy in the skill would keep quoting the
// retired value with this suite still green. Each is written exactly as `prompts/review.md` writes it,
// which is the only form a copy could take.
//
// **A single run's own figures are deliberately absent, and the omission is the rule rather than a
// gap.** #1414's 42.0 s and #1399's 132.8 s are both arithmetic over one merged run, whose durations
// never change — which is why the skill is allowed to keep run #1399's worked example below its
// detector, and `diag-skill.test.ts` pins it present. Forbidding a per-run value here would contradict
// that allowance and fail on a legitimately re-quoted immutable reading.
const DIAG_FORBIDDEN_FIGURES: ReadonlyArray<string> = [
	'occurred 6 · did not occur 2 · could not tell 12',
	'6 of the 8 runs',
	'median 100.2 s',
	'median 4.6%',
	// The four component sums, and the bimodal split's share of the third.
	'256.6 s',
	'182.7 s',
	'94.4 s',
	'34.9 s',
	'85.7 s',
]

describe(`${DIAG_SKILL} — the ranker is pointed at the record, and quotes none of it`, () => {
	const content = read_unwrapped(DIAG_SKILL)

	it.each(DIAG_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each(DIAG_FORBIDDEN_FIGURES)('leaves the figure %j to the single source', (figure) => {
		expect(content).not.toContain(figure)
	})
})
