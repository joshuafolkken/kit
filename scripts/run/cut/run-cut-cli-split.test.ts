import { lane_ledger } from '#scripts/lane/lane-ledger'
import { describe, expect, it, vi } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { CONTEXT_UNDER, ISSUE, printed_errors, session_verdict, verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

// joshuafolkken/kit#7183: `lane:plan` warned once about the size, so the pre-gate cut never repeats it —
// it reads no split notice off the ledger and answers on the context alone.
describe('the pre-gate cut of a lane over its size bar', () => {
	it('reads no split notice and prints no size warning as it cuts', async () => {
		const target = vi.spyOn(lane_ledger, 'target')

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe(run_cut_cli.CUT_VERDICT)
		expect(target).not.toHaveBeenCalled()
		expect(printed_errors()).not.toMatch(/size warning|split notice/u)
	})

	it('goes on to the gate under the cut threshold with no size warning', async () => {
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe(run_cut_cli.UNDER_THRESHOLD_VERDICT)
		expect(printed_errors()).not.toMatch(/size warning|split notice/u)
	})
})
