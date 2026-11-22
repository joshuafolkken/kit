import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'

// joshuafolkken/kit#8673: the whole screen each existing look draws — wargames with its lamp panel
// (joshuafolkken/kit#8376), matrix, and no theme — in 24-bit color, pinned so a theme added beside them
// leaves them as they were.

const { LOCAL, harness, plan_titled } = run_board_fixture
const LIVE_LOOKS = [
	['wargames', ['--theme', 'wargames']],
	['matrix', ['--theme', 'matrix']],
	['no theme', []],
] as const

async function framed(flags: ReadonlyArray<string>): Promise<string> {
	const { ports, frames } = harness(LOCAL, [plan_titled('a')])

	await expect(run_board_cli.run(['--frame', '--ansi', ...flags], ports)).resolves.toBe(0)

	return frames.join('')
}

beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
	vi.stubEnv('JOSH_BOARD_ICONS', undefined)
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
	// The header clock draws local time, so the zone is pinned for the snapshot to match on every machine.
	vi.stubEnv('TZ', 'UTC')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_cli.run --frame in each existing look', () => {
	it.each(LIVE_LOOKS)('draws %s as it drew before the bttf theme', async (_look, flags) => {
		await expect(framed(flags)).resolves.toMatchSnapshot()
	})
})
