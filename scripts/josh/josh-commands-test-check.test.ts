import { describe, expect, it } from 'vitest'
import { TEST_CHECK_COMMANDS } from './josh-commands-test-check'

describe('TEST_CHECK_COMMANDS', () => {
	it('names --first-unpinned in the usage of `test:pinned`', () => {
		expect(TEST_CHECK_COMMANDS['test:pinned']?.reference[0]).toContain('--first-unpinned')
	})
})
