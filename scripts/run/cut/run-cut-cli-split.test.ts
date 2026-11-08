import { describe, expect, it } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { CONTEXT_UNDER, ISSUE, printed_errors, session_verdict, split_warning, verdict } =
	run_cut_cli_fixture

run_cut_cli_fixture.install()

const NOTE = 'size warning: got the split notice — not a stop'

// joshuafolkken/kit#6602: a split notice without a split child is a warning, not a stop — the pre-gate
// cut prints it and answers on the context alone, as for a lane that never got one.
describe('the pre-gate cut of a lane that got the split notice', () => {
	it('prints an unanswered notice and cuts as before', async () => {
		split_warning.mockResolvedValue(NOTE)

		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
		expect(printed_errors()).toContain(NOTE)
		expect(split_warning).toHaveBeenCalledWith(Number(ISSUE))
	})

	it('goes on to the gate under the cut threshold with the notice standing', async () => {
		split_warning.mockResolvedValue(NOTE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe(run_cut_cli.UNDER_THRESHOLD_VERDICT)
	})
})
