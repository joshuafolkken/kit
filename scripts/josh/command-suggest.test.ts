import { describe, expect, it } from 'vitest'
import { command_suggest, MAX_SUGGESTION_DISTANCE } from './command-suggest'

const COMMANDS: ReadonlyArray<string> = ['gate', 'lint', 'test', 'epic:next', 'run:hold']

describe('command_suggest.edit_distance', () => {
	it('is zero for identical strings', () => {
		expect(command_suggest.edit_distance('gate', 'gate')).toBe(0)
	})

	it('counts a single substitution as distance one', () => {
		expect(command_suggest.edit_distance('gat', 'gate')).toBe(1)
	})

	it('counts insertions and deletions', () => {
		expect(command_suggest.edit_distance('', 'test')).toBe(4)
		expect(command_suggest.edit_distance('tests', 'test')).toBe(1)
	})
})

describe('command_suggest.closest_command', () => {
	it('returns the nearest command for a near typo', () => {
		expect(command_suggest.closest_command('gat', COMMANDS)).toBe('gate')
		expect(command_suggest.closest_command('lnt', COMMANDS)).toBe('lint')
	})

	it('returns undefined when nothing is within the distance threshold', () => {
		expect(command_suggest.closest_command('zzzzzzzz', COMMANDS)).toBeUndefined()
	})

	it('returns undefined for an empty command list', () => {
		expect(command_suggest.closest_command('gate', [])).toBeUndefined()
	})

	it('drops a match exactly beyond the threshold', () => {
		const far = 'g'.repeat(MAX_SUGGESTION_DISTANCE + 'gate'.length + 1)

		expect(command_suggest.closest_command(far, ['gate'])).toBeUndefined()
	})
})
