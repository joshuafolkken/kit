import { describe, expect, it } from 'vitest'
import { derive_check } from './derive-check'

// joshuafolkken/kit#7728: the argv both callers run is the derivation's own command with its check flag.
describe('derive_check', () => {
	it('runs the command the derivation names, with the check flag', () => {
		const [command, ...flags] = derive_check.DERIVE_CHECK_ARGV

		expect(derive_check.DERIVE_COMMAND).toBe(`pnpm josh ${String(command)}`)
		expect(flags).toStrictEqual([derive_check.CHECK_FLAG])
	})
})
