import { cost_pricing } from '#scripts/cost-runtime/cost-pricing'
import { describe, expect, it } from 'vitest'
import { guard_friction } from './guard-friction'
import { guard_friction_fixture } from './guard-friction-fixture'

const { record, node, session, stop_line, refusal_line } = guard_friction_fixture
const CONTEXT = 50_000
const LATER_CONTEXT = 80_000
const INVESTIGATION = '⛔ investigation: delegate the reading'
const BATCHING = '⛔ batching: issue these together'

const ANSWER = record(2, CONTEXT)
const LATER_ANSWER = record(6, LATER_CONTEXT)
const LANE = session(node('lane', { records: [record(0, CONTEXT), ANSWER, LATER_ANSWER] }), [
	refusal_line(1, 'a', INVESTIGATION),
	refusal_line(5, 'b', BATCHING),
	stop_line(5, '⛔ lane background stop: wait for the gate'),
	refusal_line(5, 'c', INVESTIGATION),
	refusal_line(9, 'd', 'not a guard refusal'),
])

describe('guard_friction.guard_rows', () => {
	const rows = guard_friction.guard_rows([LANE])

	it('counts refusals and Stop re-entries per guard, the most frequent first', () => {
		expect(rows.map((row) => [row.guard, row.refusals, row.stops])).toEqual([
			['investigation', 2, 0],
			['batching', 1, 0],
			['lane background stop', 0, 1],
		])
	})

	it('prices each hit at its share of the request that answered it', () => {
		const answer = cost_pricing.cost_of([ANSWER])
		const later = cost_pricing.cost_of([LATER_ANSWER])

		expect(rows[0]?.usd).toBeCloseTo(answer + later / 3)
		expect(rows[1]?.usd).toBeCloseTo(later / 3)
	})

	it('counts a request that answered parallel hits once in the total', () => {
		const total = rows.reduce((sum, row) => sum + row.usd, 0)
		const answers = cost_pricing.cost_of([ANSWER]) + cost_pricing.cost_of([LATER_ANSWER])

		expect(total).toBeCloseTo(answers)
	})

	it('prices a hit the session ended on at nothing', () => {
		const ended = session(node('ended', { records: [record(0, CONTEXT)] }), [
			refusal_line(3, 'a', BATCHING),
		])

		expect(guard_friction.guard_rows([ended])[0]?.usd).toBe(0)
	})
})

describe('guard_friction.report_lines', () => {
	it('heads the per-guard rows with the run totals', () => {
		const lines = guard_friction.report_lines(guard_friction.guard_rows([LANE]))

		expect(lines[0]).toMatch(/^Guard friction: 3 refusal\(s\), 1 Stop re-entry\(ies\), \$/u)
		expect(lines[1]).toMatch(/^ {2}investigation: 2 refused, 0 stopped, \$/u)
	})

	it('says none when no guard fired', () => {
		expect(guard_friction.report_lines([])).toEqual(['Guard friction: none'])
	})
})
