import { describe, expect, it } from 'vitest'
import { time_unit_purpose } from './time-unit-purpose'

describe('time_unit_purpose.classify', () => {
	it('reads a forked review from its brief command', () => {
		expect(time_unit_purpose.classify('running pnpm josh review:brief on the diff')).toBe('review')
		expect(time_unit_purpose.classify('invoking /code-review high')).toBe('review')
	})

	it('reads an investigation from its return contract', () => {
		const brief = 'Return ONLY your conclusions plus file:line citations, never the file text'

		expect(time_unit_purpose.classify(brief)).toBe('investigation')
	})

	it('is unknown when no marker matches', () => {
		expect(time_unit_purpose.classify('some unrelated transcript content')).toBe('unknown')
	})

	// A review into review tooling can mention an investigation contract too; review wins.
	it('reads review before investigation when both markers appear', () => {
		const mixed = 'pnpm josh review:brief — Return ONLY your conclusions'

		expect(time_unit_purpose.classify(mixed)).toBe('review')
	})
})
