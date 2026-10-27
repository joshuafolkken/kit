import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { TEST_CHECK_COMMANDS } from './josh-commands-test-check'

describe('TEST_CHECK_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(TEST_CHECK_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('names --first-unpinned in the usage of `test:pinned`', () => {
		expect(TEST_CHECK_COMMANDS['test:pinned']?.reference[0]).toContain('--first-unpinned')
	})
})
