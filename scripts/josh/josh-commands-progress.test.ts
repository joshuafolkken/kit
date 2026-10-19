import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { PROGRESS_COMMANDS } from './josh-commands-progress'

describe('PROGRESS_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(PROGRESS_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `run:board` on its entry', () => {
		expect(PROGRESS_COMMANDS['run:board']?.usage.examples.length).toBeGreaterThan(0)
	})
})
