import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, COMMAND_MAP } from './josh-command-map'
import { josh_logic } from './josh-logic'

const COMMAND_COLUMN_END = 28

function listed_commands(is_all: boolean, is_consumer: boolean): ReadonlyArray<string> {
	return josh_logic
		.format_help(is_all, is_consumer)
		.split('\n')
		.filter((line) => line.startsWith('  '))
		.map((line) => line.slice(2, COMMAND_COLUMN_END).trim().split(/,\s*/u).at(-1) ?? '')
}

describe('help audience', () => {
	it.each([false, true])(
		'lists only developer commands by default for consumer=%s',
		(is_consumer) => {
			const expected = CATEGORY_ORDER.flatMap((category) =>
				Object.entries(COMMAND_MAP)
					.filter(([, entry]) => entry.category === category && entry.reference[1] === 'developer')
					.filter(([, entry]) => !is_consumer || !entry.is_kit_only)
					.map(([command]) => command),
			)

			expect(listed_commands(false, is_consumer)).toEqual(expected)
		},
	)

	it.each([false, true])(
		'lists all executable commands in detail for consumer=%s',
		(is_consumer) => {
			const expected = CATEGORY_ORDER.flatMap((category) =>
				Object.entries(COMMAND_MAP)
					.filter(([, entry]) => entry.category === category)
					.filter(([, entry]) => !is_consumer || !entry.is_kit_only)
					.map(([command]) => command),
			)

			expect(listed_commands(true, is_consumer)).toEqual(expected)
		},
	)

	it('keeps aliases for both common and detailed commands', () => {
		expect(josh_logic.format_help()).toContain('ga, gate')
		expect(josh_logic.format_help(true)).toContain('fu, followup')
	})
})
