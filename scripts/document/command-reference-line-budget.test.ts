import { describe, expect, it } from 'vitest'
import { command_reference_line_budget } from './command-reference-line-budget'

const { long_line_count, long_line_violation, MAX_LONG_LINES } = command_reference_line_budget

const LONG_LINE = 'x'.repeat(401)
const LIMIT_LINE = 'x'.repeat(400)

describe('command_reference_line_budget.long_line_count', () => {
	it('counts only the lines past the length limit, across every page', () => {
		expect(long_line_count([`${LONG_LINE}\n${LIMIT_LINE}`, LONG_LINE])).toBe(2)
	})
})

describe('command_reference_line_budget.long_line_violation', () => {
	it('passes a count at the ceiling', () => {
		expect(long_line_violation(MAX_LONG_LINES)).toBeUndefined()
	})

	it('names the count and the ceiling once the count is over it', () => {
		const over = MAX_LONG_LINES + 1

		expect(long_line_violation(over)).toContain(
			`has ${over.toString()} lines over 400 characters, over its ceiling of ${MAX_LONG_LINES.toString()}`,
		)
	})
})
