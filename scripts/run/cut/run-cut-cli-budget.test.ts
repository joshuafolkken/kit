import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const {
	CONTEXT_UNDER,
	ISSUE,
	budget_over: over_minutes,
	launch,
	printed_errors,
	session_verdict,
	split_warning,
	target,
	verdict,
} = run_cut_cli_fixture

run_cut_cli_fixture.install()

const OVER_MINUTES = 31
const NOTE = 'size warning: got the split notice — not a stop'

// joshuafolkken/kit#6026: an implementation past its stage budget with a green part checked ships that
// part and spills the rest, rather than being cut and resumed into it.
describe('the pre-gate cut of an implementation over its budget', () => {
	it('answers budget-over with the spill, without cutting or relaunching', async () => {
		over_minutes.mockResolvedValue(OVER_MINUTES)

		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.BUDGET_OVER_VERDICT])
		expect(printed_errors()).toContain(
			`pnpm josh issue:spill ${ISSUE} --estimate "<files> ファイル / <lines> 行"`,
		)
		expect(printed_errors()).toContain(`${String(OVER_MINUTES)} min over`)
		expect(over_minutes).toHaveBeenCalledWith(Number(ISSUE))
		expect(launch).not.toHaveBeenCalled()
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})

	it('cuts as before when run_cut_budget answers no overrun', async () => {
		expect([await run_cut_cli.run([ISSUE]), verdict()]).toStrictEqual([0, run_cut_cli.CUT_VERDICT])
	})

	it('answers under-threshold as before within the budget', async () => {
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		expect(await run_cut_cli.run([ISSUE])).toBe(0)
		expect(verdict()).toBe(run_cut_cli.UNDER_THRESHOLD_VERDICT)
	})

	it('reads the budget past an unanswered split notice, which only warns', async () => {
		split_warning.mockResolvedValue(NOTE)
		over_minutes.mockResolvedValue(OVER_MINUTES)

		await run_cut_cli.run([ISSUE])

		expect(over_minutes).toHaveBeenCalledWith(Number(ISSUE))
		expect(verdict()).not.toBe('split-unresolved')
	})
})
