import { stripVTControlCharacters } from 'node:util'
import { gh_core_rate_limit, type CoreRateLimit } from '#scripts/gh/gh-core-rate-limit'
import { git_gh_transport } from '#scripts/gh/git-gh-transport'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { Quotas } from './run-board-quota-read'

// joshuafolkken/kit#6559: the live board reads GitHub's core rate limit through the shared reader, one
// plain frame draws it on the usage row, and a failed read leaves the board drawn without it.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const QUOTAS: Quotas = {
	claude: { windows: [{ minutes: 300, used_percent: 42, resets_ms: START }], taken_ms: START },
	codex: undefined,
}
const HOUR_MS = 3_600_000
const CORE: CoreRateLimit = { remaining: 4321, limit: 5000, reset_ms: START + HOUR_MS }
const TRANSPORT = 'graphql (auto)'

afterEach(() => {
	vi.restoreAllMocks()
})

async function once_frame(read_rate_limit: () => Promise<CoreRateLimit | undefined>): Promise<{
	code: number
	frame: string
}> {
	const board = harness(LOCAL, [plan_titled('a')])

	board.gathering.read_quotas = vi.fn(async () => QUOTAS)
	const code = await run_board_cli.run(['--once'], { ...board.ports, read_rate_limit })

	return { code, frame: stripVTControlCharacters(board.frames.join('\n')) }
}

describe('run_board_cli.LIVE_PORTS rate limit', () => {
	it('reads the core rate limit through the shared reader, with the session transport', async () => {
		const read_core = vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(CORE)

		vi.spyOn(git_gh_transport, 'label').mockResolvedValue(TRANSPORT)

		await expect(run_board_cli.LIVE_PORTS.read_rate_limit?.()).resolves.toStrictEqual({
			...CORE,
			transport: TRANSPORT,
		})
		expect(read_core).toHaveBeenCalledOnce()
	})

	it('asks no transport when the read finds no allowance', async () => {
		vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
		const label = vi.spyOn(git_gh_transport, 'label')

		await expect(run_board_cli.LIVE_PORTS.read_rate_limit?.()).resolves.toBeUndefined()
		expect(label).not.toHaveBeenCalled()
	})
})

describe('run_board_cli.run --once rate limit', () => {
	it('draws the core allowance on the usage row beside the usage limits', async () => {
		const { code, frame } = await once_frame(async () => CORE)

		expect(code).toBe(0)
		expect(frame).toContain('⛽ usage')
		expect(frame).toMatch(/github\s+14% \S+ {2}↻ \S+\s+679\/5000/u)
	})

	it('draws the board and the usage limits without the allowance when the read fails', async () => {
		const { code, frame } = await once_frame(async () => {
			throw new Error('HTTP 403')
		})

		expect(code).toBe(0)
		expect(frame).toContain('⛽ usage')
		expect(frame).toContain('claude')
		expect(frame).not.toContain('github')
	})
})
