import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'

// `josh cost`'s command-map registration, split from cost-cli.test.ts to keep that file under its
// line limit (joshuafolkken/kit#1937). It reads only the registry, so it needs none of that file's
// transcript-writing harness.

describe('josh cost registration', () => {
	it('is registered as a josh command', () => {
		const { cost } = COMMAND_MAP

		expect(cost?.script).toBe('scripts/cost/cost-cli.ts')
	})

	it('has a short alias', () => {
		const { co } = ALIASES

		expect(co).toBe('cost')
	})
})
