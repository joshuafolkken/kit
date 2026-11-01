import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { EPIC_COMMANDS } from './josh-commands-epic'

describe('EPIC_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(EPIC_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `epic:next` on its entry', () => {
		expect(EPIC_COMMANDS['epic:next']?.usage.examples.length).toBeGreaterThan(0)
	})

	it('documents `--notify` among the flags of `epic`', () => {
		const names = EPIC_COMMANDS['epic']?.usage.flags?.flatMap((flag) => flag.names)

		expect(names).toContain('--notify')
	})
})
