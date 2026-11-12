import { describe, expect, it } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { CONTEXT_UNDER, ISSUE, printed_errors, session_verdict, verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

// joshuafolkken/kit#7010: a started Issue is implemented to the end — an implementation past its stage
// budget is neither spilled nor shipped part-way; the overrun stays in `lane:stats` / `lane:breakdown`,
// so `run:cut` reads no budget and answers on the context verdict alone.
describe('the pre-gate cut of an implementation over its budget', () => {
	it('cuts on the context verdict without answering budget-over or a spill', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
		expect(printed_errors()).not.toContain('issue:spill')
		expect(printed_errors()).not.toContain('budget-over')
	})

	it('answers under-threshold as before within the budget', async () => {
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe(run_cut_cli.UNDER_THRESHOLD_VERDICT)
	})
})
