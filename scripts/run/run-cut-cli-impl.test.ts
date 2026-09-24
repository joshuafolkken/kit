import { describe, expect, it } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { ISSUE, target, launch, verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

const FAILURE_EXIT_CODE = 1

describe('the implementation cut needs its handoff', () => {
	// joshuafolkken/kit#2484: a cut with no instruction relaunched a successor its own resume then
	// refused `incomplete`, so the child was parked. The cut is refused instead, relaunching nothing.
	it('refuses an --impl cut without a handoff and relaunches nothing', async () => {
		const code = await run_cut_cli.run(['--impl', ISSUE])

		expect([code, verdict()]).toStrictEqual([FAILURE_EXIT_CODE, run_cut_cli.BAD_HANDOFF_VERDICT])
		expect(run_cut.read_cut(target()).kind).toBe('none')
		expect(launch).not.toHaveBeenCalled()
	})
})

describe('the retired setup-phase cut', () => {
	// joshuafolkken/kit#2489: the unconditional setup cut is retired, so `--setup` is a usage error that
	// records and relaunches nothing rather than a cut taken under another name.
	it('refuses --setup without recording or relaunching anything', async () => {
		const code = await run_cut_cli.run(['--setup', ISSUE])

		expect(code).toBe(FAILURE_EXIT_CODE)
		expect(run_cut.read_cut(target()).kind).toBe('none')
		expect(launch).not.toHaveBeenCalled()
	})
})
