import { describe, expect, it } from 'vitest'
import { AGENT_HOOK_COMMANDS } from './josh-commands-agent-hooks'

describe('AGENT_HOOK_COMMANDS', () => {
	it('carries the usage of `pretool:guard` on its entry', () => {
		expect(AGENT_HOOK_COMMANDS['pretool:guard']?.usage.examples.length).toBeGreaterThan(0)
	})
})
