import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const {
	ISSUE,
	CONTEXT_UNDER,
	CUT_KIND,
	target,
	launch,
	session_verdict,
	emit,
	verdict,
	existing_cut,
	WITH_HANDOFF,
} = run_cut_cli_fixture

run_cut_cli_fixture.install()

// joshuafolkken/kit#2346: the setup-phase cut. `--setup` cuts at the earliest boundary — the plan is
// posted, so the setup context is done — and records that phase; its resume continues into
// implementation, its record is cleared on resume like the implementation cut's, and every cut appends
// a `cut` event to the run's stream so `run:step` advances past the boundary.
describe('cutting a lane child at the setup boundary', () => {
	// The under-threshold verdict proves the setup cut is unconditional, unlike the pre-gate cut: the
	// setup context is below the threshold by construction, so a cost-gated cut would never fire.
	it('cuts unconditionally, records the setup phase, and appends the cut event', async () => {
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		const code = await run_cut_cli.run(['--setup', ...WITH_HANDOFF, ISSUE])
		const read = run_cut.read_cut(target())

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.CUT_VERDICT)
		expect(read.kind === 'carried' ? read.cut.phase : undefined).toBe(run_cut.SETUP_PHASE)
		expect(emit).toHaveBeenCalledWith(CUT_KIND, expect.stringContaining(ISSUE))
	})

	// joshuafolkken/kit#2484: a setup cut with no instruction relaunched a successor its own resume then
	// refused `incomplete`, so the child was parked. The cut is refused instead, relaunching nothing.
	it.each([['--setup'], ['--impl']])(
		'refuses a %s cut without a handoff and relaunches nothing',
		async (flag) => {
			const code = await run_cut_cli.run([flag, ISSUE])

			expect([code, verdict()]).toStrictEqual([1, run_cut_cli.BAD_HANDOFF_VERDICT])
			expect(run_cut.read_cut(target()).kind).toBe('none')
			expect(launch).not.toHaveBeenCalled()
		},
	)

	it('resumes into implementation and clears the record', async () => {
		existing_cut(run_cut.SETUP_PHASE)

		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect([code, verdict()]).toStrictEqual([0, run_cut_cli.RESUME_IMPL_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('none')
	})
})
