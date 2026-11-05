import { describe, expect, it } from 'vitest'
import { SHIP_COMMANDS } from './josh-commands-ship'

describe('SHIP_COMMANDS', () => {
	it('carries the usage of `ship` on its entry', () => {
		expect(SHIP_COMMANDS['ship']?.usage.examples.length).toBeGreaterThan(0)
	})

	it('advertises the opt-in clean join ship and its caller contract (ac-dda2d0e2)', () => {
		const chain = SHIP_COMMANDS['run:chain']

		expect(chain?.reference[0]).toContain('[--ship "<title> #<N>"]')
		expect(chain?.usage.examples).toContainEqual({
			arguments: '<N> --join --ship "<title> #<N>"',
			note: 'ship a clean round; title must match the issue. Record interaction review first.',
		})
	})
})
