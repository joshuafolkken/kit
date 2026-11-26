import { launch_timing } from '#scripts/lane/launch-timing'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_thread, type GatherWorker } from './run-board-gather-thread'
import type { BoardPorts } from './run-board-state'
import { run_board_timing } from './run-board-timing'

// joshuafolkken/kit#8825: `run:board --timing` says the redraw stage's main-thread work outside its
// draw — a worker round received, the view stepped, the opening revealed and a cue's sound prepared.

const { harness } = run_board_fixture
const { received, report } = run_board_timing
const STEP_MS = 2
const { FIRST_ROUND, LOCAL, START } = run_board_fixture
const READ = { ...run_board_gather.FRESH_GATHER, local: LOCAL, read_ms: START }
const POST = run_board_gather_thread.post_of(
	FIRST_ROUND.board,
	READ,
	{ ...FIRST_ROUND.data, ...run_board_gather.read_of(READ) },
	START,
).post

function at_start(): number {
	return START
}

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

	it('counts a cue sounded within the tick draw as sound alone, never in the tick too', () => {
		const { board, leave } = timed_board()

		board.time_draw?.('tick', () => board.cue?.('launch'))
		const said = leave()

		expect(said).toMatch(/tick draw +max 4\.0/u)
		expect(said).toMatch(/redraw sound +total 2\.0/u)
	})

	it('leaves the cue as it came without the flag', () => {
		const { ports } = harness(undefined, [])
		const cue = vi.fn()

		expect(run_board_timing.timed({ ...ports, cue }, false).cue).toBe(cue)
	})
})

// A gather worker whose `post` hands its listener a round.
function posting_worker(): GatherWorker & { post: (value: unknown) => void } {
	const listening: { message?: (value: unknown) => void } = {}

	return {
		on: (event, listener) => {
			if (event === 'message') listening.message = listener
		},
		unref: vi.fn(),
		post: (value) => listening.message?.(value),
	}
}

describe('run_board_timing.received', () => {
	it('hands the round over timed as the redraw receive while a timed board is up', () => {
		const { leave } = timed_board()
		const receive = vi.fn()

		received(receive, 'thread', 'post')

		expect(receive).toHaveBeenCalledWith('thread', 'post')
		expect(leave()).toMatch(/redraw receive +total 2\.0/u)
	})

	it('times the round a gather worker posts as the redraw receive', async () => {
		const { leave } = timed_board()
		const worker = posting_worker()
		const first = run_board_gather_thread.worker_gatherer(() => worker, at_start)('background')

		worker.post(POST)
		await first

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
