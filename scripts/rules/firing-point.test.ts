import { describe, expect, it } from 'vitest'
import { firing_point } from './firing-point'

describe('firing_point.classify', () => {
	it('matches a hook-deliverable tool call name', () => {
		expect(firing_point.classify('AskUserQuestion')).toBe('delivered')
		expect(firing_point.classify('Bash')).toBe('delivered')
	})

	it('reports a real but undeliverable tool as a mismatch', () => {
		expect(firing_point.classify('WebFetch')).toBe('not-delivered')
	})

	it('reports a name that is not a tool call at all as not in the table', () => {
		expect(firing_point.classify('SomethingMadeUp')).toBe('unknown')
	})

	it('ignores surrounding whitespace', () => {
		expect(firing_point.classify('  Edit  ')).toBe('delivered')
	})

	it('keeps the deliverable and undeliverable sets disjoint', () => {
		const overlap = firing_point.HOOK_DELIVERABLE_TOOLS.filter((name) =>
			firing_point.KNOWN_UNDELIVERABLE_TOOLS.includes(name),
		)

		expect(overlap).toEqual([])
	})
})
