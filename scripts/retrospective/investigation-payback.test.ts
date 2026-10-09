import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { guard_friction_fixture } from './guard-friction-fixture'
import { investigation_payback } from './investigation-payback'

const { record, node, session, refusal_line, investigator_call_line } = guard_friction_fixture
const { BRANCH } = time_transcript_fixture
const SMALL = 40_000
const LARGE = 120_000
const UNIT_CONTEXT = 10_000

const REFUSED_ANSWER = record(2, SMALL)
const INSIDE_UNIT = node('lean/agent-a', {
	role: 'subagent',
	parent_id: 'lean',
	records: [record(4, UNIT_CONTEXT)],
})
const OUTSIDE_UNIT = node('lean/agent-b', {
	role: 'subagent',
	parent_id: 'lean',
	records: [record(9, UNIT_CONTEXT)],
})
const LEAN = session(node('lean', { records: [record(0, SMALL), REFUSED_ANSWER] }), [
	refusal_line(1, 'r', '⛔ investigation: delegate the reading'),
	investigator_call_line(3, 'call'),
	time_transcript_fixture.result_line(5, BRANCH, 'call', 'conclusion'),
])
const HEAVY = session(node('heavy', { records: [record(0, SMALL), record(1, LARGE)] }), [])

describe('investigation_payback.groups', () => {
	const sessions = [LEAN, HEAVY, session(INSIDE_UNIT, []), session(OUTSIDE_UNIT, [])]
	const { delegated, kept } = investigation_payback.groups(sessions)

	it('splits the main-line sessions by whether they dispatched an investigator', () => {
		expect([delegated.sessions, kept.sessions]).toEqual([1, 1])
	})

	it("reports each group's mean and peak context", () => {
		expect([delegated.mean_context, delegated.mean_peak_context]).toEqual([SMALL, SMALL])
		expect([kept.mean_context, kept.mean_peak_context]).toEqual([(SMALL + LARGE) / 2, LARGE])
	})

	it("prices the guard as its refusals' round trips plus the units inside the dispatch", () => {
		const expected =
			cost_pricing.cost_of([REFUSED_ANSWER]) + cost_pricing.cost_of(INSIDE_UNIT.records)

		expect(delegated.refusals).toBe(1)
		expect(delegated.guard_usd).toBeCloseTo(expected)
		expect(kept.guard_usd).toBe(0)
	})
})

describe('investigation_payback.report_lines', () => {
	it('prints one line per group under a heading', () => {
		const lines = investigation_payback.report_lines([LEAN, HEAVY])

		expect(lines[0]).toBe('Investigation guard payback (main-line sessions):')
		expect(lines[1]).toMatch(/^ {2}delegated: 1 session\(s\), mean context 40,000/u)
		expect(lines[2]).toMatch(/^ {2}not delegated: 1 session\(s\), mean context 80,000/u)
	})

	it('reads the guard label off the investigation reason', () => {
		expect(investigation_payback.INVESTIGATION_GUARD).toBe('investigation')
	})
})
