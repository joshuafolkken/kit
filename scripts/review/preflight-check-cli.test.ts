import type { Unmet } from '#scripts/git/git-preflight'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chain_mock = vi.hoisted(() => vi.fn<() => Promise<Array<Unmet>>>())

vi.mock('#scripts/run/ship/run-ship-preflight', () => ({
	run_ship_preflight: { chain_problems: chain_mock },
}))

const { preflight_check_cli } = await import('./preflight-check-cli')

// joshuafolkken/kit#7773: ship's preflight judgments that need no PR, asked before the review and
// named by the kind the ship would stop on.

const REFUSED_EXIT = 1
const USAGE_EXIT = 2
const REMOVED = { kind: 'removed-tests', problem: '`board > shades` has no disposition' }
const UNPLANNED = { kind: 'unplanned', problem: 'unplanned: scripts/gate/gate-plan.ts' }

const info_lines: Array<string> = []
const error_lines: Array<string> = []

beforeEach(() => {
	chain_mock.mockReset().mockResolvedValue([])
	info_lines.length = 0
	error_lines.length = 0
	vi.spyOn(console, 'info').mockImplementation((line: string) => {
		info_lines.push(line)
	})
	vi.spyOn(console, 'error').mockImplementation((line: string) => {
		error_lines.push(line)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('preflight_check_cli.run', () => {
	it('passes a tree every judgment holds on', async () => {
		await expect(preflight_check_cli.run([])).resolves.toBe(0)

		expect(info_lines).toStrictEqual([preflight_check_cli.PASS])
	})

	it('refuses naming each unmet precondition by its kind', async () => {
		chain_mock.mockResolvedValue([REMOVED, UNPLANNED])

		await expect(preflight_check_cli.run([])).resolves.toBe(REFUSED_EXIT)

		const out = error_lines.join('\n')

		expect(out).toContain(`  - removed-tests: ${REMOVED.problem}`)
		expect(out).toContain(`  - unplanned: ${UNPLANNED.problem}`)
	})

	it('prints the usage on an argument, asking nothing', async () => {
		await expect(preflight_check_cli.run(['7773'])).resolves.toBe(USAGE_EXIT)

		expect(error_lines).toStrictEqual([preflight_check_cli.USAGE])
		expect(chain_mock).not.toHaveBeenCalled()
	})
})
