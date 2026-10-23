import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import { run_board_gather_thread, type GatherWorker } from './run-board-gather-thread'
import { run_board_render } from './run-board-render'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4387: a read that throws on the worker no longer ends it — the round is handed over
// as failed, with why, and the next round reads again. A board that has read nothing yet says the
// reads failed rather than `no run`.

const { START, LOCAL, WORDS, harness } = run_board_fixture
const { FRESH_GATHER } = run_board_gather
const { gather_round, worker_gatherer } = run_board_gather_thread
const { FRESH_STATE, tick } = run_board_tick
const { render_no_run } = run_board_render
const REASON = 'spawn git ENOENT'
// The run's age, drawn only on a board that read a run.
const RUN_AGE = '⏰'
const FAILED = new RegExp(String.raw`❗ ${WORDS.read} \d{2}:\d{2} ${REASON}$`, 'mu')
const LONG_REASON = 'x'.repeat(200)
const REASON_LIMIT = 40

type Listener = (value: unknown) => void

// One fake worker the board listens to, and the post a worker round hands it.
function fake_worker(): { worker: GatherWorker; post: Listener } {
	const listeners = new Map<string, Listener>()
	const worker: GatherWorker = {
		on: (event, listener) => listeners.set(event, listener),
		unref: vi.fn(),
	}

	return { worker, post: (value) => listeners.get('message')?.(value) }
}

function collector(): { posts: Array<unknown>; post: Listener } {
	const posts: Array<unknown> = []

	return {
		posts,
		post: (value) => {
			posts.push(value)
		},
	}
}

function last_frame(frames: ReadonlyArray<string>): string {
	return stripVTControlCharacters(frames.at(-1) ?? '')
}

// A board over a fake worker whose first round's run read throws.
function failing_board(): {
	board: ReturnType<typeof harness>
	live: Parameters<typeof tick>[1]
	post: Listener
} {
	const board = harness(LOCAL, [])
	const { worker, post } = fake_worker()

	board.read_local.mockRejectedValueOnce(new Error(REASON))

	return {
		board,
		live: {
			...board.ports,
			gather: worker_gatherer(
				() => worker,
				() => START,
			),
		},
		post,
	}
}

describe('run_board_gather_thread.gather_round', () => {
	it('hands a throwing round over as failed, keeps its state, and reads again next round', async () => {
		const { gathering, read_local } = harness(LOCAL, [])
		const { posts, post } = collector()

		read_local.mockRejectedValueOnce(new Error(`${REASON}\n    at spawn`))
		const kept = await gather_round(FRESH_GATHER, gathering, post)
		const next = await gather_round(kept, gathering, post)

		expect(kept).toBe(FRESH_GATHER)
		expect(posts[0]).toStrictEqual({ failed: REASON })
		expect(next.local).toStrictEqual(LOCAL)
		expect(posts[1]).toHaveProperty('read')
	})
})

describe('run_board_tick.tick over a worker round that threw', () => {
	it('says the reads failed and why, not no run, then draws the board once the next round reads', async () => {
		const { board, live, post } = failing_board()
		const failed_frame = tick(FRESH_STATE, live, 'background')
		const kept = await gather_round(FRESH_GATHER, board.gathering, post)
		const failed = await failed_frame

		expect(last_frame(board.frames)).toMatch(FAILED)
		expect(last_frame(board.frames)).not.toContain(WORDS.no_run)

		await gather_round(kept, board.gathering, post)
		await tick(failed, live, 'background')

		expect(last_frame(board.frames)).not.toContain('❗')
		expect(last_frame(board.frames)).toContain(RUN_AGE)
	})
})

describe('run_board_render.render_no_run over failed reads', () => {
	it('cuts a long reason so the line keeps to its width', () => {
		const [line = ''] = render_no_run(START, {}, { read_failed_ms: START, read_error: LONG_REASON })
		const drawn = stripVTControlCharacters(line)

		expect(drawn).toContain(`${'x'.repeat(REASON_LIMIT - 1)}…`)
		expect(drawn).not.toContain('x'.repeat(REASON_LIMIT))
	})

	it('ends on the minute when the failure carries no reason', () => {
		const [line = ''] = render_no_run(START, {}, { read_failed_ms: START, read_error: '' })

		expect(stripVTControlCharacters(line)).toMatch(/❗ read \d{2}:\d{2}$/u)
	})

	it('says no run when no read failed', () => {
		expect(render_no_run(START).join('')).toContain(WORDS.no_run)
	})
})
