import { describe, expect, it } from 'vitest'
import { epic_cli_untrack } from './epic-cli'

describe('epic child untrack arguments', () => {
	it('recognizes only the untrack form', () => {
		expect(epic_cli_untrack.is_untrack(['--untrack', '900', '101'])).toBe(true)
		expect(epic_cli_untrack.is_untrack(['--remove', '900', '101'])).toBe(false)
	})
	it('reads a deduplicated child set', () => {
		expect(epic_cli_untrack.parse_arguments(['--untrack', '900', '101', '102', '101'])).toEqual({
			epic_number: 900,
			children: [101, 102],
		})
	})
	it.each([
		['--untrack'],
		['--untrack', '900'],
		['--untrack', 'bad', '101'],
		['--untrack', '0', '101'],
		['--untrack', '9007199254740992', '101'],
		['--untrack', 'owner/repo#900', '101'],
		['--untrack', '900', ''],
		['--untrack', '900', '900'],
		['--untrack', '900', '101', 'oops'],
		['--untrack', '900', '0'],
		['--untrack', '900', '-1'],
		['--untrack', '900', '1.5'],
		['--untrack', '900', '9007199254740992'],
		['--untrack', '900', '101', '--add'],
	])('refuses invalid input %j', (...argv) => {
		expect(epic_cli_untrack.parse_arguments(argv)).toBeUndefined()
	})
})
