import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cli } from './run-board-cli'
import { run_board_fixture, type Harness } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { BoardPorts } from './run-board-state'

// joshuafolkken/kit#3495: a live board redraws on each second and only turns its spinners in between.
// joshuafolkken/kit#8125: each frame and each turn in synchronized output. joshuafolkken/kit#8826: a
// write between redraws changes nothing on screen but the spinners.

const { LOCAL, START, STOPPED, harness, plan_titled } = run_board_fixture
const { each_screen, is_synced_once, lines_of } = run_board_frame_fixture
const LAUNCH = { pos: 1, at: '2026-10-08T08:00:00.000Z', kind: 'child-launch', text: '#1 a' }
const PACED_MS = 2000
const SPINNERS = /[⠀-⣿]/gu

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '0')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

// A redraw begun: how long after the start, and how many writes were made before it.
interface Begun {
	at_ms: number
	written: number
}

// Ports whose sleeps move the clock, stopping the board once `PACED_MS` have passed; every write, and
// each redraw begun.
function paced(board: Harness): { live: BoardPorts; writes: Array<string>; redraws: Array<Begun> } {
	const { ports, clock } = board
	const writes: Array<string> = []
	const redraws: Array<Begun> = []
	const live: BoardPorts = {
		...ports,
		write: (text) => {
			writes.push(text)
		},
		enter_stage: (stage) => {
			if (stage === 'redraw') redraws.push({ at_ms: clock.now_ms - START, written: writes.length })
		},
		sleep: async (ms) => {
			if (clock.now_ms >= START + PACED_MS) throw STOPPED
			clock.now_ms += ms
		},
	}

	return { live, writes, redraws }
}

// Whether every write but the first each redraw made changed only spinners on screen.
function turns_only(writes: ReadonlyArray<string>, redraws: ReadonlyArray<Begun>): boolean {
	const firsts = new Set([0, ...redraws.map(({ written }) => written)])
	const screens: Array<string> = []

	each_screen(writes, (cells) => {
		screens.push(lines_of(cells).join('\n').replaceAll(SPINNERS, ''))
	})

	return screens.every((screen, index) => firsts.has(index) || screen === screens[index - 1])
}

describe('run_board_cli.run redraw pace', () => {
	it('redraws once a second on the second, writing only spinner turns between, reading nothing', async () => {
		const board = harness({ ...LOCAL, events: [LAUNCH] }, [plan_titled('a')])
		const { live, writes, redraws } = paced(board)

		await expect(run_board_cli.run([], live)).rejects.toBe(STOPPED)
		const frames = writes.slice(1, -1)

		expect(redraws.map(({ at_ms }) => at_ms)).toStrictEqual([0, 1000, 2000])
		expect(frames.length).toBeGreaterThan(redraws.length)
		expect(frames.every((frame) => is_synced_once(frame))).toBe(true)
		expect(turns_only(writes.slice(0, -1), redraws)).toBe(true)
		expect(board.read_machine).toHaveBeenCalledTimes(redraws.length)
		expect(board.read_local).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#8826: the live board writes through a port that waits out the terminal's
// backpressure, so the frame loop makes no frame the terminal is not ready for.
describe('run_board_cli.LIVE_PORTS backpressure', () => {
	it('gives the live board a drained wait beside its write', () => {
		expect(run_board_cli.LIVE_PORTS.write).toBeTypeOf('function')
		expect(run_board_cli.LIVE_PORTS.drained).toBeTypeOf('function')
	})
})
