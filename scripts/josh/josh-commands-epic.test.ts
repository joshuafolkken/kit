import { describe, expect, it } from 'vitest'
import { EPIC_COMMANDS } from './josh-commands-epic'

describe('EPIC_COMMANDS', () => {
	it('carries the usage of `epic:next` on its entry', () => {
		expect(EPIC_COMMANDS['epic:next']?.usage.examples.length).toBeGreaterThan(0)
	})

	it('documents `--notify` among the flags of `epic`', () => {
		const names = EPIC_COMMANDS['epic']?.usage.flags?.flatMap((flag) => flag.names)

		expect(names).toContain('--notify')
	})
})
