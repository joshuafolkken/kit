import { describe, expect, it } from 'vitest'
import { PROGRESS_COMMANDS } from './josh-commands-progress'

describe('PROGRESS_COMMANDS', () => {
	it('carries the usage of `run:board` on its entry', () => {
		expect(PROGRESS_COMMANDS['run:board']?.usage.examples.length).toBeGreaterThan(0)
	})
})
