import { afterEach, describe, expect, it, vi } from 'vitest'
import { josh_logic, USAGE_ERROR_EXIT_CODE } from './josh-logic'

// A consumer's help drops kit-only commands, and running one is refused with guidance; inside kit the
// commands stay reachable (joshuafolkken/kit#1988).

// The alias-plus-name prefix a help line carries, which is specific enough to assert a command's
// presence without matching a substring inside a description.
const EVAL_LINE = 'ev, eval'
const COST_LINE = 'co, cost'

describe('format_help hides kit-only commands from a consumer', () => {
	it("lists eval in kit's own --all listing", () => {
		expect(josh_logic.format_help(true, false)).toContain(EVAL_LINE)
	})

	it('drops eval from a consumer listing even with --all', () => {
		expect(josh_logic.format_help(true, true)).not.toContain(EVAL_LINE)
	})

	it('keeps cost in a consumer detailed listing', () => {
		expect(josh_logic.format_help(true, true)).toContain(COST_LINE)
		expect(josh_logic.format_help(false, true)).not.toContain(COST_LINE)
	})
})

describe('run_command refuses a kit-only command in a consumer', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('prints guidance and exits non-zero for eval', async () => {
		const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const exit_code = await josh_logic.run_command('eval', [], true)

		expect(exit_code).toBe(USAGE_ERROR_EXIT_CODE)
		expect(errors).toHaveBeenCalledWith(expect.stringContaining('josh eval'))
	})
})
