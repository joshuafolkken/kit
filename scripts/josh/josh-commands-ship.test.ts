import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { SHIP_COMMANDS } from './josh-commands-ship'

describe('SHIP_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(SHIP_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `ship` on its entry', () => {
		expect(SHIP_COMMANDS['ship']?.usage.examples.length).toBeGreaterThan(0)
	})
})
