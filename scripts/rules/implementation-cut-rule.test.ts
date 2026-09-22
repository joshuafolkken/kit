import { read_unwrapped, WORKFLOW_PROMPT_DIRECTORY } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { implementation_cut } from './implementation-cut'

// joshuafolkken/kit#2310: the implementation-phase cut existed, was documented, and its verdict was
// read only at session entry — so it fired **0 times** across five lanes while 33.9% of their requests
// ran past 200,000 tokens. What this suite pins is the correction turned into a delivered refusal: that
// the rule is delivered at the `Edit` / `Write` it binds on, that its procedure stays in one place, and
// that the enumeration names both the topic section and the suites that fix it.
//
// **The measurement is the load-bearing half.** Without the 0-of-5 / 33.9% figures the row reads as a
// precaution, and a precaution is the first thing dropped when the enumeration is next trimmed.
const TOPIC_FILE = '.claude/skills/workflow-commands/pre-gate-cut.md'
const DELIVERY = `${WORKFLOW_PROMPT_DIRECTORY}/rule-delivery.md`
const FIRING_SUITE = 'scripts/rules/implementation-cut.test.ts'
const RULE_SUITE = 'scripts/rules/implementation-cut-rule.test.ts'
// The section this rule's procedure is single-sourced under; a marker test exists so a rewrite of the
// document is caught rather than silently dropping the heading a sibling rule leans on.
const TOPIC_HEADING =
	'### It is a guard, fired at the edit that crosses the threshold (joshuafolkken/kit#2310)'
const CUT_COMMAND = 'pnpm josh run:cut --impl <N>'

describe('the delivered text — what the refusal states', () => {
	const delivered = implementation_cut.IMPLEMENTATION_CUT_REASON

	// The pointer is where the procedure is, and this rule never was resident in `CLAUDE.md` to point
	// back at — it binds only after a dispatched lane child is already over threshold.
	it('names the topic file rather than the resident document', () => {
		expect(delivered).toContain(TOPIC_FILE)
		expect(delivered).not.toContain('CLAUDE.md')
	})

	// **A refusal that named the command but not what its answer obliges would be half a rule.** `cut`
	// is the only verdict that ends the turn, and the resume continues implementing (`resume-impl`)
	// rather than gating, which the run cannot infer from the verdict alone.
	it('hands over the command and what its verdicts oblige', () => {
		expect(delivered).toContain(CUT_COMMAND)
		expect(delivered).toContain('end the turn immediately')
		expect(delivered).toContain('resume-impl')
	})

	// **The one measurement, so a reader knows this is not a second one** (joshuafolkken/kit#1933): the
	// guard reads `pnpm josh cost --cut`'s verdict, the same statistic against the same threshold.
	it('states that it reads the one measurement, never a second', () => {
		expect(delivered).toContain('never a second measurement')
	})

	// **The dispatch mark is what fires the refusal, so a person sees none** (joshuafolkken/kit#1904).
	it('states that the dispatch mark fired it, and a person carries none', () => {
		expect(delivered).toContain('the dispatch mark names this lane')
		expect(delivered).toContain('carries no mark and sees no refusal')
	})
})

describe(`${TOPIC_FILE} — the single source for the rule and the measurement behind it`, () => {
	const content = read_unwrapped(TOPIC_FILE)

	it.each([
		TOPIC_HEADING,
		'**This step was carried as prose and fired exactly never**',
		// The figures the enforcement rests on.
		'the cut fired **0 times**',
		'33.9%',
		'pnpm josh rule:guard',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// **The re-arm contract is the whole of joshuafolkken/kit#2310**: the resume clears the record so
	// both guards re-arm, and a record left in place would silence them for the rest of the run. The two
	// silent states are what keep the row worth having rather than refusing every edit a person makes.
	it.each([
		'**It fires for a marked child and nowhere else**',
		'**It re-arms per resume, not per edit**',
		'**It is silent between a cut and its resume**',
		'the implementation resume clears the record',
	])('states the boundary %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${DELIVERY} — the enumeration names this rule and its suites`, () => {
	const content = read_unwrapped(DELIVERY)

	it.each([
		TOPIC_HEADING.replace('### ', '').replace(' (joshuafolkken/kit#2310)', ''),
		RULE_SUITE,
		FIRING_SUITE,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})
