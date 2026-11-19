import { launch_timing } from '#scripts/lane/launch-timing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture } from './run-board-fixture'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_timing } from './run-board-timing'

// joshuafolkken/kit#7929: `run:board --timing` says what the first board waited on, phase by phase.

const { STOPPED, harness } = run_board_fixture
const { FIRST_FRAME_PHASE, FIRST_READ_PHASE, TIMING_FLAG, report, split } = run_board_timing
const HEADING = 'run:board timing (ms):'
const REBUILD_MS = 812.4

const LANES_PHASE = 'local: lanes'
const LOCAL_PHASES = ['local: span', LANES_PHASE, 'local: roots', 'local: events', 'local: room']

beforeEach(() => {
	launch_timing.clear()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_cli.USAGE', () => {
	it('names the timing flag', () => {
		expect(run_board_cli.USAGE).toContain(`[${TIMING_FLAG}]`)
	})
})

describe('run_board_read.read_local timing', () => {
	it('records each local read the first board waits on by name', async () => {
		const { CARRY, arrange } = run_board_read_fixture

		arrange({ kind: 'carried', carry: CARRY }, undefined)
		await run_board_read.read_local()

		expect(launch_timing.phases().map(({ name }) => name)).toStrictEqual(
			expect.arrayContaining(LOCAL_PHASES),
		)
	})
})

describe('run_board_timing.split', () => {
	it('takes the flag out wherever it stands', () => {
		expect(split(['--once', TIMING_FLAG])).toStrictEqual({ argv: ['--once'], is_timing: true })
	})

	it('leaves an argv without it as it came', () => {
		expect(split(['--once'])).toStrictEqual({ argv: ['--once'], is_timing: false })
	})
})

describe('run_board_timing.report', () => {
	it('says the launcher rebuild and each phase by name, in whole ms', () => {
		launch_timing.set_rebuild_ms(REBUILD_MS)
		launch_timing.mark(LANES_PHASE, 2.6)

		expect(report()).toBe(`${HEADING}\n  rebuild       812\n  local: lanes  3\n`)
	})
})

// joshuafolkken/kit#8126: each tick and turn drawn is timed, and the report says their max and median.
describe('run_board_timing.timed draws', () => {
	const TICK_DRAW = /tick draw {2}max 4\.0 · median 2\.5 \(n 2\)/u
	const TURN_DRAW = /turn draw {2}max 2\.0 · median 2\.0 \(n 1\)/u

	it('says the max and median of each kind it timed as the board leaves', () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const clock = [0, 4, 10, 11, 20, 22]
		const board = run_board_timing.timed(ports, true, () => clock.shift() ?? 0)

		expect(board.time_draw?.('tick', () => 'drawn')).toBe('drawn')
		board.time_draw?.('tick', () => 0)
		board.time_draw?.('turn', () => 0)
		board.on_exit(() => 0)
		leaves.at(-1)?.()

		expect(frames.at(-1)).toMatch(TICK_DRAW)
		expect(frames.at(-1)).toMatch(TURN_DRAW)
	})

	it('names no kind it never timed', () => {
		expect(report({ tick: [1], turn: [] })).not.toContain('turn draw')
	})

	it('times nothing without the flag, drawing straight through', () => {
		const { ports } = harness(undefined, [])
		const board = run_board_timing.timed(ports, false)
		const draw = vi.fn(() => 'drawn')

		expect(board.time_draw).toBeUndefined()
		expect(run_board_timing.drawn(board, 'tick', draw)).toBe('drawn')
		expect(draw).toHaveBeenCalledOnce()
	})

	it('reports the ticks a live board drew under the flag', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([TIMING_FLAG], ports)).rejects.toBe(STOPPED)
		leaves[0]?.()

		expect(frames.at(-1)).toContain('tick draw')
	})
})

describe('run_board_cli.run --timing', () => {
	it('says the first read and the first frame after a single frame', async () => {
		const { ports, frames } = harness(undefined, [])

		await expect(run_board_cli.run(['--once', TIMING_FLAG], ports)).resolves.toBe(0)

		expect(frames).toHaveLength(2)
		expect(frames[1]).toContain(HEADING)
		expect(frames[1]).toContain(FIRST_READ_PHASE)
		expect(frames[1]).toContain(FIRST_FRAME_PHASE)
	})

	it('says them on the normal screen after a live board leaves its own', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([TIMING_FLAG], ports)).rejects.toBe(STOPPED)
		leaves[0]?.()

		expect(frames.at(-1)).toContain(FIRST_FRAME_PHASE)
		expect(frames.at(-2)).not.toContain(HEADING)
	})

	it('says nothing of timing after a single frame without the flag', async () => {
		const { ports, frames } = harness(undefined, [])

		await run_board_cli.run(['--once'], ports)

		expect(frames.join('')).not.toContain(HEADING)
	})

	it('says nothing of timing as a live board leaves without the flag', async () => {
		const { ports, frames, leaves } = harness(undefined, [])

		await expect(run_board_cli.run([], ports)).rejects.toBe(STOPPED)
		leaves[0]?.()

		expect(frames.join('')).not.toContain(HEADING)
	})
})
