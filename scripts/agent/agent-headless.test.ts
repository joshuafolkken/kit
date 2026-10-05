import { describe, expect, it } from 'vitest'
import { agent_headless } from './agent-headless'

describe('agent_headless', () => {
	it('reads its own environment fragment as headless', () => {
		expect(agent_headless.is_headless(agent_headless.environment())).toBe(true)
	})

	it.each([
		['absent', {}],
		['another value', { [agent_headless.KEY]: 'yes' }],
	])('reads an %s mark as a person session', (_name, source) => {
		expect(agent_headless.is_headless(source)).toBe(false)
	})
})
