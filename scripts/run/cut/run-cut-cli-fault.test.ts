import { describe, expect, it, vi } from 'vitest'
import { run_cut } from './run-cut'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

// joshuafolkken/kit#3589: the catch around the whole answer reported every failure as an unreadable
// git directory and dropped the failure itself, so a wrong `unknown` could not be followed back.

const { ISSUE, state, verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

const REASON = 'EACCES: permission denied'
const FAILURE_EXIT_CODE = 1
const UNKNOWN_VERDICT = 'unknown'

function explanations(): Array<string> {
	return vi.mocked(console.error).mock.calls.map(([text]) => String(text))
}

describe('an unknown answer says why', () => {
	it('keeps the git directory message for a directory that cannot be resolved', async () => {
		vi.spyOn(run_cut, 'worktree_directory').mockRejectedValue(new Error(REASON))

		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([FAILURE_EXIT_CODE, UNKNOWN_VERDICT])
		expect(explanations()).toStrictEqual([run_cut.unknown_message()])
	})

	it('reports the failure itself when acting on the record throws', async () => {
		state.mockRejectedValue(new Error(REASON))

		const code = await run_cut_cli.run([ISSUE])

		expect([code, verdict()]).toStrictEqual([FAILURE_EXIT_CODE, UNKNOWN_VERDICT])
		expect(explanations()).toStrictEqual([`run:cut failed and established nothing: ${REASON}`])
	})
})
