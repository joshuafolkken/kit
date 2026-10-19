import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { AGENT_HOOK_COMMANDS } from './josh-commands-agent-hooks'

describe('AGENT_HOOK_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(AGENT_HOOK_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `pretool:guard` on its entry', () => {
		expect(AGENT_HOOK_COMMANDS['pretool:guard']?.usage.examples.length).toBeGreaterThan(0)
	})
})
