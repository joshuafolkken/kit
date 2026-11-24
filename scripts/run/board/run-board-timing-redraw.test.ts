import { launch_timing } from '#scripts/lane/launch-timing'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_intro } from './run-board-intro'
import { run_board_intro_fixture } from './run-board-intro-fixture'
import type { BoardPorts, DrawKind, DrawTimer } from './run-board-state'
import { run_board_timing } from './run-board-timing'

// joshuafolkken/kit#8825: `run:board --timing` says the redraw stage's main-thread work outside its
// draw — a worker round received, the view stepped, the opening revealed and a cue's sound prepared.

const { harness } = run_board_fixture
const { received, report } = run_board_timing
const { NO_KEYS, instant, read_at_once } = run_board_intro_fixture
const STEP_MS = 2

beforeEach(() => {
	launch_timing.clear()
})

// A clock each read of which moves `STEP_MS` on, so every timed section takes `STEP_MS`.
function stepping(): Mock<() => number> {
	let now_ms = 0

	return vi.fn(() => {
		now_ms += STEP_MS

		return now_ms
	})
}

interface Timed {
	board: BoardPorts
	cue: Mock
	now: Mock<() => number>
	leave: () => string | undefined
}

// A board under `--timing` with a cue of its own, on the screen; `leave` says its report.
function timed_board(): Timed {
	const { ports, frames, leaves } = harness(undefined, [])
	const cue = vi.fn()
	const now = stepping()
	const board = run_board_timing.timed({ ...ports, cue }, true, { now })

	board.on_exit(() => 0)

	return {
		board,
		cue,
		now,
		leave: () => {
			leaves.at(-1)?.()

			return frames.at(-1)
		},
	}
}

describe('run_board_timing.report redraw sections', () => {
	it('says each redraw section timed with its total, apart from the draws', () => {
		const draws = { tick: [1], turn: [], receive: [2, 4], view: [], reveal: [], sound: [] }
		const said = report(draws)

		expect(said).toMatch(/tick draw +max 1\.0 · median 1\.0 \(n 1\)/u)
		expect(said).toMatch(/redraw receive +total 6\.0 · max 4\.0 · median 3\.0 \(n 2\)/u)
		expect(said).not.toContain('redraw view')
	})
})

describe('run_board_timing.timed sound', () => {
	it('sounds the cue timed as the redraw sound under the flag', () => {
		const { board, cue, leave } = timed_board()

		board.cue?.('launch')

		expect(cue).toHaveBeenCalledWith('launch')
		expect(leave()).toMatch(/redraw sound +total 2\.0/u)
	})

	it('leaves the cue as it came without the flag', () => {
		const { ports } = harness(undefined, [])
		const cue = vi.fn()

		expect(run_board_timing.timed({ ...ports, cue }, false).cue).toBe(cue)
	})
})

// A draw timer that keeps each kind it ran a draw as.
function recording(kinds: Array<DrawKind>): DrawTimer {
	return function time<T>(kind: DrawKind, draw: () => T): T {
		kinds.push(kind)

		return draw()
	}
}

describe('run_board_intro.opening reveal timing', () => {
	it('times the opening typed and the first frame revealed as the redraw reveal', async () => {
		const kinds: Array<DrawKind> = []
		const { written, ports } = run_board_intro_fixture.recorded(instant)
		const timed = { ...ports, time_draw: recording(kinds) }
		const opened = run_board_intro.opening(read_at_once, timed, NO_KEYS, 'wargames')

		await opened.gather('settled')
		await opened.reveal?.('a\nb')

		expect(written.length).toBeGreaterThan(0)
		expect(kinds.length).toBeGreaterThan(written.length)
		expect(new Set(kinds)).toStrictEqual(new Set(['reveal']))
	})
})

describe('run_board_timing.received', () => {
	it('hands the round over timed as the redraw receive while a timed board is up', () => {
		const { leave } = timed_board()
		const receive = vi.fn()

		received(receive, 'thread', 'post')

		expect(receive).toHaveBeenCalledWith('thread', 'post')
		expect(leave()).toMatch(/redraw receive +total 2\.0/u)
	})

	it('hands the round over untimed once the report is said', () => {
		const { now, leave } = timed_board()
		const receive = vi.fn()

		leave()
		now.mockClear()
		received(receive, 'post')

		expect(receive).toHaveBeenCalledWith('post')
		expect(now).not.toHaveBeenCalled()
	})
})
