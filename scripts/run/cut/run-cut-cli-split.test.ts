import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const {
	CONTEXT_UNDER,
	ISSUE,
	launch,
	printed_errors,
	session_verdict,
	split_refusal,
	target,
	verdict,
} = run_cut_cli_fixture

run_cut_cli_fixture.install()

const FAILURE_EXIT_CODE = 1
const NOTE = 'got the split notice and has neither a recorded reason nor a split child'

// joshuafolkken/kit#4695: the pre-gate cut is the boundary the split notice names, so a lane that got
// it and neither split nor recorded why stops there — cut or no cut — and is told how to answer.
describe('the pre-gate cut of a lane that got the split notice', () => {
	it('refuses an unanswered notice without cutting or relaunching', async () => {
		split_refusal.mockResolvedValue(NOTE)

		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([
			FAILURE_EXIT_CODE,
			run_cut_cli.SPLIT_UNRESOLVED_VERDICT,
		])
		expect(printed_errors()).toContain(NOTE)
		expect(launch).not.toHaveBeenCalled()
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	it('refuses it even when the context is under the cut threshold', async () => {
		split_refusal.mockResolvedValue(NOTE)
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		expect(await run_cut_cli.run([ISSUE])).toBe(FAILURE_EXIT_CODE)
		expect(verdict()).toBe(run_cut_cli.SPLIT_UNRESOLVED_VERDICT)
	})

	it('cuts as before once the notice is answered', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
		expect(split_refusal).toHaveBeenCalledWith(Number(ISSUE))
	})
})
