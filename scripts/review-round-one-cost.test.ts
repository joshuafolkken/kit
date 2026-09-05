import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1436. joshuafolkken/kit#1305 recorded round 1's cost against the size of its
// input at a small sample and said, in the record itself, that a larger sample was exactly what
// would overturn it. This suite pins the re-measurement that did, and the decision it produced.
//
// **The overturn is why the pinning matters more here than for a confirming reading.** A retired
// coefficient that stays quotable is worse than no record at all: it is cited by three other
// sections, so a reader who finds the old number and not the new one refuses a proposal on evidence
// that no longer exists — or accepts one for the same reason. The markers below keep the current
// reading, the sections that were re-pointed at it, and the decision in one place.
//
// **This comment states no figure**, on the rule `review-round-two-cost.test.ts` already states: the
// canonical section owns them, a re-fit moves that section and the markers below in the same edit,
// and a number copied into a comment stays green at the retired value.
const REVIEW_PROMPT = 'prompts/review.md'
const DIAG_SKILL = '.claude/skills/diag/SKILL.md'
const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const SECTION_TITLE =
	"Round 1's cost does track the change size, and splitting is still not how to cut it"

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_TITLE}`,
	// That this is a re-measurement of a specific earlier reading, and that the earlier one lost. Both
	// halves are load-bearing: without the first the section reads as a competing measurement, and
	// without the second a reader keeps two live coefficients for one question.
	'**joshuafolkken/kit#1436 took the re-measurement the first of these sections invited, and it came back the other way.**',
	'**The relation is real, and it is the rest of this section that decides the question.**',
	// The sample, and the share of the window that carries no round 1 at all. A coefficient quoted
	// without the unreadable share reads as covering every run of the window, which is the
	// over-reading the instrument's own rules forbid.
	'**23 carry a round-1 duration and 7 do not.**',
	'**That is 23% of the window, and it is unreadable rather than zero**',
	// The fit, and the share of variance it does not explain. The correlation alone supports the
	// proposal this section rejects; only the intercept-versus-slope split rejects it.
	'**Fitted rather than correlated, because the decision turns on the split.**',
	'**242 s plus 0.086 s per changed line**',
	'`R² = 0.30`',
	'**117 s against a fixed 242 s**',
	// The arithmetic that answers the question the issue was filed to answer, and the statement that
	// the crossover it asked for does not exist. Dropping the second half leaves a reader looking for
	// a boundary that was already searched for.
	'**Splitting one Issue in two adds a whole intercept, at every size.**',
	'**the round-1 total rises by about 242 s whatever the diff was**',
	'**the answer is nowhere in the measured range and nowhere above it**',
	// The descriptive half. A fit with a real coefficient invites a reader to trust it further than
	// the residuals allow, and the within-size group is what says how far that is.
	'**The spread inside one size is wider than the spread across sizes.**',
	'**12 of 22 adjacent pairs have round 1 falling as the diff rises**',
]

// The decision itself, with both rejected entrances named. **A recorded choice without its rejected
// alternatives is not a decision record** — the next reader cannot tell whether the other entrance
// was weighed or forgotten, and re-proposes it from the issue body.
//
// The third bullet is not one of the two entrances. It is the direction that was out of scope from
// the start, pinned because a record of "neither speed measure was taken" is exactly the paragraph a
// later reader mines for a cheaper one.
const DECISION_MARKERS: ReadonlyArray<string> = [
	'**So neither entrance is taken.**',
	"**Moving the split assessment's threshold is not taken.**",
	'**Narrowing what round 1 reads is not taken either.**',
	'it is refused on the intercept',
	'**Reducing what round 1 finds was never a candidate.**',
	'**Nothing decided here changes what a round 1 reads or what it reports.**',
	// The fixed point, which is the third thing the issue asked for. Without the "which column"
	// half, the next re-measurement is a second classification and the two cannot be compared.
	'**The fixed point, for whoever proposes this next.**',
	'**Report the two coefficients and never a median**',
	'**Report how many runs of the window were unreadable too**',
	// A kept decision needs a withdrawal condition, or it becomes permanent by default.
	'**What would reopen it.**',
	'**A single large run above the fit is not that**',
]

// The three places that cited the retired coefficient and now say so. Pinned because the failure
// mode is silent: each one still reads correctly on its own, and only the added sentence tells a
// reader that the number under it has been superseded.
const RE_POINTED_MARKERS: ReadonlyArray<string> = [
	'**It has since been re-measured, and it was overturned**',
	'**What it was cited for survives the overturn**',
	'**The first of those two bars has since moved**',
	'**The first of those three coefficients has been re-measured since**',
	'**the conclusion above is unaffected**',
]

describe(`${REVIEW_PROMPT} — the re-measurement and the decision are recorded`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each([...CANONICAL_MARKERS, ...DECISION_MARKERS, ...RE_POINTED_MARKERS])(
		'states %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)
})

// `diag` is where both rejected proposals are re-derived: it ranks the `review` phase off this run's
// tables every time and holds no memory of what an earlier reading concluded. The pointer carries the
// section title and **no figure at all**, guarded below.
const DIAG_MARKERS: ReadonlyArray<string> = [
	SECTION_TITLE,
	"**The third is where the first one's round-1 coefficient was re-measured and overturned**",
	'**It also decides two proposals a `diag` re-derives from the `review` row every time**',
	'**Read all three before ranking `review`, and quote no figure from any of them that you have not read there**',
]

// Every pointer document is guarded by the same list, so the case name is written once. The suites
// stay separate because a figure pasted into one document is a different mistake from the same figure
// pasted into another, and the failure has to name which one it was found in.
const FORBIDDEN_FIGURE_CASE = 'leaves the figure %j to the single source'

// The three documents that cite this record without owning any of its figures. **The command doc is
// on the list because it was the one citer this change nearly missed**: `josh review:round2`'s
// description quoted the retired coefficient as live, where a `review-round-two-cost.test.ts` guard
// reaching only the skill could not see it.
const POINTER_DOCS: ReadonlyArray<string> = [DIAG_SKILL, SPLIT_SKILL, COMMAND_DOC]

// The figures the canonical section owns, asserted absent from every pointer document. A prose
// instruction not to copy them is not enforcement; this is. Every entry is written exactly as the
// canonical section writes it, which is the only form a copy could take — so a figure re-worded
// there is re-worded here in the same edit.
//
// **The retired pair is on the list too, and that is the point of the list.** `r = 0.05` and `n = 9`
// are forbidden here as well as in `review-round-two-cost.test.ts`, because that suite's absence
// guard reaches the `diag` skill alone: the split assessment, whose whole subject is whether diff
// size is a criterion, is the likeliest place for the retired number to reappear and had no guard at
// all. Two suites forbidding one string in overlapping document sets is not the staleness this
// pattern is about — a figure is retired in one edit and both lists move with it.
const FORBIDDEN_FIGURES: ReadonlyArray<string> = [
	'r = 0.55',
	'r = 0.56',
	'242 s plus 0.086 s per changed line',
	'R² = 0.30',
	'117 s against a fixed 242 s',
	'23 carry a round-1 duration and 7 do not',
	'12 of 22 adjacent pairs',
	'2,800 changed lines',
	'376.5 s, 273.6 s and 214.4 s',
	// The pair this record retired. Quoted as live anywhere, it refuses a proposal on evidence that
	// no longer exists — the failure the command doc was already carrying.
	'r = 0.05',
	'n = 9',
]

describe.each(POINTER_DOCS)('%s — quotes no figure of the round-1 record', (document_path) => {
	it.each(FORBIDDEN_FIGURES)(FORBIDDEN_FIGURE_CASE, (figure) => {
		expect(read_unwrapped(document_path)).not.toContain(figure)
	})
})

describe(`${DIAG_SKILL} — the ranker is pointed at the round-1 record`, () => {
	const content = read_unwrapped(DIAG_SKILL)

	it.each(DIAG_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The split assessment is the other place the proposal is re-derived, and the more likely one: its
// own test already says the answer is not "large" and not "touches many files", which reads as an
// omission until the measurement behind it is named. The note carries the reason and the pointer and
// no figure, on the same rule as the skill above.
const SPLIT_MARKERS: ReadonlyArray<string> = [
	'## Diff size is not a criterion, and that is measured',
	'**The test above says the answer is not "large" and not "touches many files", and that exclusion is measured rather than stylistic.**',
	'**It does track it — and splitting an Issue in two to shorten round 1 lengthens it**',
	SECTION_TITLE,
	'**A proposal to add a size threshold here is required to say why that data does not reach it**',
	// Without this the note reads as having softened the assessment, which is the one thing
	// `split-assessment-document-rule.test.ts` exists to prevent at every entry point.
	'**It changes nothing about the assessment itself.**',
]

describe(`${SPLIT_SKILL} — the size threshold is refused with its reason`, () => {
	const content = read_unwrapped(SPLIT_SKILL)

	it.each(SPLIT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
