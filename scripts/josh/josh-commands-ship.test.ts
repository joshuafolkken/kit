import { describe, expect, it } from 'vitest'
import { SHIP_COMMANDS } from './josh-commands-ship'

describe('SHIP_COMMANDS', () => {
	it('carries the usage of `ship` on its entry', () => {
		expect(SHIP_COMMANDS['ship']?.usage.examples.length).toBeGreaterThan(0)
	})
})
