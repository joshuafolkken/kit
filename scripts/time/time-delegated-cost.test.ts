import { describe, expect, it } from 'vitest'
import { time_delegated_cost, type DelegatedUnit } from './time-delegated-cost'

// joshuafolkken/kit#1882: what launching each subagent cost, summed over the run — and the scopes
// that did not read the corpus say so rather than reporting a run that spent nothing.

function unit(
	session_id: string,
	baseline_tokens: number,
	cost_usd: number,
	is_priced = true,
): DelegatedUnit {
	return { session_id, baseline_tokens, cost_usd, is_priced }
}

describe('time_delegated_cost.build', () => {
	it('leaves the block unmeasured when no reading was supplied', () => {
		expect(time_delegated_cost.build(undefined).is_measured).toBe(false)
	})

	it('measures an empty reading as a run with no delegated unit', () => {
		const facts = time_delegated_cost.build([])

		expect([facts.is_measured, facts.unit_count]).toEqual([true, 0])
	})

	it('sums the launches and averages them per subagent', () => {
		const facts = time_delegated_cost.build([unit('a', 400_000, 1), unit('b', 600_000, 2)])

		expect([facts.unit_count, facts.baseline_tokens, facts.cost_usd]).toEqual([2, 1_000_000, 3])
		expect([facts.per_unit_tokens, facts.per_unit_cost_usd]).toEqual([500_000, 1.5])
	})

	it('orders the units most expensive first', () => {
		const facts = time_delegated_cost.build([unit('cheap', 1, 0.5), unit('dear', 1, 5)])

		expect(facts.units.map((one) => one.session_id)).toEqual(['dear', 'cheap'])
	})

	it('counts the units the price table could not cost', () => {
		const facts = time_delegated_cost.build([unit('priced', 1, 1), unit('bare', 1, 0, false)])

		expect(facts.unpriced_unit_count).toBe(1)
	})
})

describe('time_delegated_cost.cost_lines', () => {
	it('emits nothing where the scope never carried the record', () => {
		expect(time_delegated_cost.cost_lines(undefined)).toEqual([])
	})

	it('says the corpus was not read for an unmeasured scope', () => {
		const lines = time_delegated_cost.cost_lines(time_delegated_cost.build(undefined)).join('\n')

		expect(lines).toContain(time_delegated_cost.NOT_MEASURED_NOTE)
	})

	it('says no subagent ran for a measured empty run', () => {
		const lines = time_delegated_cost.cost_lines(time_delegated_cost.build([])).join('\n')

		expect(lines).toContain(time_delegated_cost.NONE_NOTE)
	})

	it('prints a row per unit, the total and the per-subagent average', () => {
		const built = time_delegated_cost.build([unit('agent-x', 500_000, 1.1)])
		const lines = time_delegated_cost.cost_lines(built).join('\n')

		expect(lines).toContain(time_delegated_cost.TOTAL_LABEL)
		expect(lines).toContain(time_delegated_cost.PER_UNIT_LABEL)
		expect(lines).toContain('$1.10')
		expect(lines).toContain('500000 tokens')
	})

	it('flags a floor when a unit could not be priced', () => {
		const built = time_delegated_cost.build([unit('bare', 1, 0, false)])
		const lines = time_delegated_cost.cost_lines(built).join('\n')

		expect(lines).toContain(time_delegated_cost.UNPRICED_NOTE)
	})

	it('truncates a long session id in the row label', () => {
		const built = time_delegated_cost.build([unit('session-0123456789abcdef0123456789', 1, 1)])
		const lines = time_delegated_cost.cost_lines(built).join('\n')

		expect(lines).toContain('…')
	})
})
