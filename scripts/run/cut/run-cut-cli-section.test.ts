import { run_step_section } from '#scripts/run/run-step-section'
import { describe, expect, it } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

// joshuafolkken/kit#5953: a non-trivial verdict is followed by the `pre-gate-cut.md` section it acts on,
// so a lane child never opens the whole document; `not-a-lane` and `fresh` leave nothing to act on.

const {
	CONTEXT_UNDER,
	ISSUE,
	WITH_HANDOFF,
	find_open_lane,
	print_section,
	session_verdict,
	verdict,
	existing_cut,
} = run_cut_cli_fixture

run_cut_cli_fixture.install()

describe('the section run:cut prints after its verdict', () => {
	it('prints "Taking the cut" after a cut', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.CUT_VERDICT)
		expect(print_section).toHaveBeenCalledExactlyOnceWith(run_step_section.CUT)
	})

	it('prints no section after an implementation cut', async () => {
		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(print_section).not.toHaveBeenCalled()
	})

	it('prints no section when the context is under the threshold', async () => {
		session_verdict.mockReturnValue(CONTEXT_UNDER)

		await run_cut_cli.run([ISSUE])

		expect(verdict()).toBe(run_cut_cli.UNDER_THRESHOLD_VERDICT)
		expect(print_section).not.toHaveBeenCalled()
	})

	it('prints no section on not-a-lane', async () => {
		find_open_lane.mockResolvedValue(undefined)

		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.NOT_A_LANE_VERDICT)
		expect(print_section).not.toHaveBeenCalled()
	})
})

describe('the section run:cut --resume prints after its verdict', () => {
	it('prints "Resuming" after a resume', async () => {
		existing_cut()

		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
		expect(print_section).toHaveBeenCalledExactlyOnceWith(run_step_section.RESUME)
	})

	it('prints no section on fresh', async () => {
		const code = await run_cut_cli.run(['--resume', ISSUE])

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_cli.FRESH_VERDICT)
		expect(print_section).not.toHaveBeenCalled()
	})
})

describe('the run:cut section rows', () => {
	it('names the pre-gate-cut.md sections each mode acts on', () => {
		expect(run_step_section.GOVERNING_SECTIONS.get(run_step_section.CUT)?.heading).toBe(
			'Taking the cut',
		)
		expect(run_step_section.GOVERNING_SECTIONS.get(run_step_section.RESUME)?.heading).toBe(
			'Resuming',
		)
	})
})
