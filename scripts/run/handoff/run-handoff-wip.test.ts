import { describe, expect, it } from 'vitest'
import { run_handoff_wip } from './run-handoff-wip'

const SHA = 'abc1234def'

describe('run_handoff_wip.environment_of', () => {
	it('hands down nothing without --wip', async () => {
		await expect(run_handoff_wip.environment_of(undefined, async () => SHA)).resolves.toStrictEqual(
			{ environment: {} },
		)
	})

	it('refuses a branch naming no commit', async () => {
		const result = await run_handoff_wip.environment_of('wip/none', async () => undefined)

		expect(result).toStrictEqual({ problem: '--wip: no branch wip/none in this repository' })
	})

	it('hands down the branch with the commit it resolves to', async () => {
		const result = await run_handoff_wip.environment_of('wip/x', async () => SHA)

		expect(result).toStrictEqual({ environment: { JOSH_HANDOFF_WIP: `wip/x@${SHA}` } })
	})
})

describe('run_handoff_wip.with_environment', () => {
	it('adds the environment to the launch request', () => {
		const request = { argv: { command: 'claude', args: [] }, cwd: '/repo', env: { A: '1' } }
		const result = run_handoff_wip.with_environment(request, { B: '2' })

		expect(result.env).toStrictEqual({ A: '1', B: '2' })
	})
})
