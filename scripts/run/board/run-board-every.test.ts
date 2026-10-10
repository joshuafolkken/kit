import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import type { LocalRead } from './run-board-read'

// joshuafolkken/kit#3569: `run:board --every <minutes>` pushes the chat frame off-screen each interval,
// with no model in between, and ends with the run.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const ESCAPE = '\u{1B}'
const FIVE_MINUTES_MS = 300_000
const ENDED: LocalRead = { ...LOCAL, ended_ms: START + FIVE_MINUTES_MS }
const PLANS = [plan_titled('a'), plan_titled('a'), plan_titled('a')]

// A run read as running for the given number of frames, then as ended.
function ending_after(running: number): () => Promise<LocalRead> {
	let read = 0

	return async () => {
		read += 1

		return read > running ? ENDED : LOCAL
	}
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_cli.run --every', () => {
	it('pushes one chat frame per interval and ends after pushing the ended run', async () => {
		const { ports, pushes, frames } = harness(LOCAL, PLANS)
		const slept: Array<number> = []
		const sleep = vi.fn(async (ms: number) => {
			slept.push(ms)
		})

		await expect(
			run_board_cli.run(['--every', '5'], { ...ports, read_local: ending_after(2), sleep }),
		).resolves.toBe(0)

		expect(pushes).toHaveLength(3)
		expect(pushes.join('')).not.toContain(ESCAPE)
		expect(pushes.slice(0, 2).join('')).not.toContain('■ backlogrun')
		expect(pushes[2]).toMatch(/^■ backlogrun/u)
		expect(slept).toStrictEqual([FIVE_MINUTES_MS, FIVE_MINUTES_MS])
		expect(frames).toHaveLength(0)
	})

	it('pushes nothing and ends at once when no run has started here', async () => {
		const { ports, pushes } = harness(undefined, [])

		await expect(run_board_cli.run(['--every', '5'], ports)).resolves.toBe(0)

		expect(pushes).toHaveLength(0)
	})

	it('pushes nothing while JOSH_PROGRESS=0 is set', async () => {
		const { ports, pushes } = harness(LOCAL, PLANS)
		const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

		vi.stubEnv('JOSH_PROGRESS', '0')

		await expect(run_board_cli.run(['--every', '5'], ports)).resolves.toBe(0)

		expect(pushes).toHaveLength(0)
		expect(stderr).toHaveBeenCalledWith(`${run_board_cli.DISABLED_NOTICE}\n`)
	})
})

describe('run_board_cli.run --every arguments', () => {
	it.each([[['--every']], [['--every', '0']], [['--every', 'x']], [['--every', '5', '--once']]])(
		'refuses %j',
		async (argv) => {
			const { ports, pushes } = harness(LOCAL, PLANS)
			const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

			await expect(run_board_cli.run(argv, ports)).resolves.toBe(1)

			expect(pushes).toHaveLength(0)
			expect(stderr).toHaveBeenCalledWith(`${run_board_cli.USAGE}\n`)
		},
	)
})
