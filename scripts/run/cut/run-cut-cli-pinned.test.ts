import { describe, expect, it } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'

const { CONTEXT_UNDER, ISSUE, WITH_HANDOFF, launch_at_cut, session_verdict } = run_cut_cli_fixture

run_cut_cli_fixture.install()

// joshuafolkken/kit#9165: the cut before the gate starts the settled tree's `josh test:pinned`, so the
// probe runs beside `run:chain`'s open stages; a cut during implementation has no settled tree.
describe('josh run:cut — the test:pinned launch', () => {
	it.each([
		['over the context threshold', undefined],
		['under it', CONTEXT_UNDER],
	])('launches it once on a pre-gate cut %s', async (_label, context) => {
		if (context !== undefined) session_verdict.mockReturnValue(context)

		await run_cut_cli.run([ISSUE])

		expect(launch_at_cut).toHaveBeenCalledOnce()
	})

	it('launches nothing on an implementation cut', async () => {
		await run_cut_cli.run(['--impl', ISSUE, ...WITH_HANDOFF])

		expect(launch_at_cut).not.toHaveBeenCalled()
	})
})
