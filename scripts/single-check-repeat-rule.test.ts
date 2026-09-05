import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1383: joshuafolkken/kit#1246 decided how many *gates* a run pays for and left the
// checks it sends an implementation loop to instead unbounded. Measured on the run of
// joshuafolkken/kit#1379, the fix phase issued eight of them — 45.9 seconds and a round trip each —
// and `pnpm josh gate` ran all four checks over the same tree 18.1 seconds after the last one.
//
// Each marker below is one place the rule is read from. The definition lives in one document and the
// other two name it: a copy in the skill is how the two come to say different things, and a rule
// stated only in the review prompt never reaches a run following its own entry procedure.
const REVIEW_PROMPT = 'prompts/review.md'
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const DOCS = 'docs/josh-commands.md'

const SECTION_POINTER = 'A single check answers once per tree'

// The rule's single source: what the line is, what it deliberately does not cap, the one prescribed
// call it excludes, and the decision on what carries it. The last is load-bearing — a reader who
// takes "no mechanism yet" as "the measurement decided nothing" has inverted the outcome.
const REVIEW_PROMPT_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_POINTER}`,
	'**The line is narrow, and only one class of call falls on the wrong side of it.**',
	'**No cap is placed on how many single checks a run makes**',
	'**`pnpm josh eval:scope` is not one of these calls.**',
	'**This document carries the rule, and `pnpm josh time` is what says whether it held.**',
	'**On the run the issue was filed from, that last figure is zero**',
]

describe(`${REVIEW_PROMPT} — the rule is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The skill's shared verification-gate bullet is the one place every implementing entry reads before
// it starts editing, so the sentence a run has to obey is carried there beside the gate count it
// refines.
describe(`${GATE_BULLET} — the gate bullet carries the sentence`, () => {
	it.each(['**And a single check answers once per tree**', SECTION_POINTER])(
		'states %j',
		(marker) => {
			expect(read_unwrapped(GATE_BULLET)).toContain(marker)
		},
	)
})

// The command reference is where the block the rule is measured by is documented, including what it
// deliberately cannot see — a figure whose error is not stated is read as a floor.
describe(`${DOCS} — the command reference documents the measurement`, () => {
	it.each([
		'**The `Single checks:` block is about the probing in front of that gate, not the gate itself**',
		'**It under-reports on purpose**',
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(read_unwrapped(DOCS)).toContain(marker)
	})
})

// Single-sourcing, asserted rather than assumed: the branch table lives in `prompts/review.md` and the
// other two point at it. A rule that says two different things in two files is worse than one stated
// once.
const TABLE_HEADER = '| Since this check last ran'
const NEVER_COPIES: ReadonlyArray<string> = [GATE_BULLET, DOCS]

describe('the branch table is stated once', () => {
	it('lives in the review prompt', () => {
		expect(read_unwrapped(REVIEW_PROMPT)).toContain(TABLE_HEADER)
	})

	it.each(NEVER_COPIES)('%s does not copy it', (path) => {
		expect(read_unwrapped(path)).not.toContain(TABLE_HEADER)
	})
})
