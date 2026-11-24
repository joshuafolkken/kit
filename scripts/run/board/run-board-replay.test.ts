import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_replay } from './run-board-replay'
import type { Beat } from './run-board-reveal-blocks'

const { LOCAL, harness, plan_titled } = run_board_fixture
const { lines_of, options_of, replay, run } = run_board_replay
const SIZE = ['--columns', '100', '--rows', '30']
const ARRIVE_TICK_MS = 50
const MINIMUM_ARRIVE_BEATS = 10

async function replayed(argv: ReadonlyArray<string>): Promise<Array<Beat>> {
	const options = options_of([...argv, ...SIZE], process.env)

	if (options === undefined) throw new Error(`refused: ${argv.join(' ')}`)
	const { ports } = harness(LOCAL, [plan_titled('a')])

	return await replay(ports, options)
}

beforeEach(() => {
	vi.stubEnv('JOSH_BOARD_THEME', undefined)
	vi.stubEnv('JOSH_BOARD_ICONS', undefined)
	vi.stubEnv('FORCE_COLOR', '3')
	vi.stubEnv('NO_COLOR', undefined)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_replay.replay', () => {
	it('writes the same bytes for the same seed twice', async () => {
		const first = lines_of(await replayed(['--theme', 'matrix', '--seed', '7']))
		const second = lines_of(await replayed(['--theme', 'matrix', '--seed', '7']))

		expect(first).not.toBe('')
		expect(second).toBe(first)
	})

	it('changes the matrix rain beats with the seed', async () => {
		const first = lines_of(await replayed(['--theme', 'matrix', '--seed', '1']))
		const second = lines_of(await replayed(['--theme', 'matrix', '--seed', '2']))

		expect(second).not.toBe(first)
	})

	it('beats the bttf arrival every 50 ms', async () => {
		const beats = await replayed(['--theme', 'bttf'])
		const arrival = beats.filter((beat) => beat.ms === ARRIVE_TICK_MS)

		expect(arrival.length).toBeGreaterThanOrEqual(MINIMUM_ARRIVE_BEATS)
	})

	it('times the opening on the virtual clock, whatever the live clock does', async () => {
		const first = lines_of(await replayed(['--theme', 'bttf', '--seed', '1']))
		let live_ms = 0

		vi.spyOn(performance, 'now').mockImplementation(() => (live_ms += ARRIVE_TICK_MS))
		const second = lines_of(await replayed(['--theme', 'bttf', '--seed', '1']))

		expect(second).toBe(first)
	})

	it('writes one JSON line per beat', () => {
		expect(lines_of([{ text: 'a', ms: 1 }])).toBe('{"text":"a","ms":1}\n')
	})
})

describe('run_board_replay.run', () => {
	it('writes the replayed beats as JSON lines and succeeds', async () => {
		const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
		const { ports } = harness(LOCAL, [plan_titled('a')])

		await expect(run(['--theme', 'bttf', ...SIZE], ports)).resolves.toBe(0)
		expect(String(write.mock.calls.at(0)?.[0])).toMatch(/^\{"text":/u)
	})

	it('prints the usage and fails on arguments it refuses', async () => {
		const error = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
		const { ports } = harness(LOCAL, [plan_titled('a')])

		await expect(run(['--theme', 'nope'], ports)).resolves.not.toBe(0)
		expect(String(error.mock.calls.at(0)?.[0])).toContain('Usage: josh board:replay')
	})
})

describe('run_board_replay.options_of', () => {
	it.each([
		[['--seed', 'x']],
		[['--ticks', '-1']],
		[['--theme', 'nope']],
		[['--notice', 'merged']],
		[['--unknown']],
		[['--icons', 'nope']],
	])('refuses %j', (argv) => {
		expect(options_of(argv, {})).toBeUndefined()
	})

	it('takes the icons from the arguments, else JOSH_BOARD_ICONS, as the live board does', () => {
		expect(options_of(['--icons', 'letters'], {})).toMatchObject({ icons: 'letters' })
		expect(options_of([], { JOSH_BOARD_ICONS: 'shapes' })).toMatchObject({ icons: 'shapes' })
	})

	it('takes the seed, the clock start and the redraws, passing the rest to the frame options', () => {
		expect(
			options_of(['--seed', '3', '--at=5', '--ticks', '2', '--columns', '80', '--mute'], {}),
		).toMatchObject({
			seed: 3,
			at_ms: 5,
			ticks: 2,
			frame: { is_muted: true, size: { columns: 80, rows: 40 } },
		})
	})
})
