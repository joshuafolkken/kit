import { describe, expect, it, vi } from 'vitest'
import { run_board_theme_layer } from './run-board-theme-layer'
import { run_board_theme_layer_fixture } from './run-board-theme-layer-fixture'

// A real start renders its part's whole track on the frame that begins the part, between the frame's
// moment and its write; a process that has rendered none yet takes longer over it than a short opening's
// letters type (the rk800 theme's one short line). Timed from the frame's moment, the opening was past
// its letters by its second frame, and their trill was never heard; a replay in demo mode, its tracks
// rendered already, sounded it. The part begins as its first frame is written.

const { ticking_run } = run_board_theme_layer_fixture
const { after_frame, rebased } = run_board_theme_layer
const ORIGIN_MS = 10_000
// Longer than the letters type: what the first frame's rendering took.
const RENDER_MS = 600
const TYPED_MS = 450
const FRAME_MS = 50
const OPENING_SOUND = { spans: [{ from_ms: 0, to_ms: TYPED_MS }], typed_ms: TYPED_MS }
const QUIET_BOARD = { is_on: false, left_ms: 0 }

// A run whose opening began on the frame drawn at the origin.
function opening_run(): ReturnType<typeof ticking_run> {
	const run = ticking_run(ORIGIN_MS)

	run.opening_sound = () => OPENING_SOUND
	run.part = { name: 'opening', start_ms: ORIGIN_MS }

	return run
}

describe('run_board_theme_layer.rebased', () => {
	it('begins a part as the frame that began it is written', () => {
		const run = opening_run()

		rebased(run, ORIGIN_MS, ORIGIN_MS + RENDER_MS)

		expect(run.part?.start_ms).toBe(ORIGIN_MS + RENDER_MS)
	})

	it('leaves a part an earlier frame began where it is', () => {
		const run = opening_run()

		rebased(run, ORIGIN_MS + FRAME_MS, ORIGIN_MS + FRAME_MS + RENDER_MS)

		expect(run.part?.start_ms).toBe(ORIGIN_MS)
	})

	it('leaves a run in no part alone', () => {
		const run = ticking_run(ORIGIN_MS)

		rebased(run, ORIGIN_MS, ORIGIN_MS + RENDER_MS)

		expect(run.part).toBeUndefined()
	})
})

describe('run_board_theme_layer.after_frame after a first frame slow to render', () => {
	it('sounds the opening’s letters for their whole time from the frame’s write', () => {
		const run = opening_run()
		const trill = { set: vi.fn(), typed: vi.fn() }
		const written_ms = ORIGIN_MS + RENDER_MS

		rebased(run, ORIGIN_MS, written_ms)
		after_frame(run, trill, ORIGIN_MS, QUIET_BOARD)
		after_frame(run, trill, written_ms + FRAME_MS, QUIET_BOARD)
		after_frame(run, trill, written_ms + TYPED_MS - FRAME_MS, QUIET_BOARD)

		expect(trill.set.mock.calls.map(([is_on]) => is_on)).toEqual([true, true, true])
		expect(trill.typed).not.toHaveBeenCalled()
	})

	it('ends the trill and sounds the typed end once the letters have typed', () => {
		const run = opening_run()
		const trill = { set: vi.fn(), typed: vi.fn() }
		const written_ms = ORIGIN_MS + RENDER_MS

		rebased(run, ORIGIN_MS, written_ms)
		after_frame(run, trill, ORIGIN_MS, QUIET_BOARD)
		after_frame(run, trill, written_ms + TYPED_MS, QUIET_BOARD)

		expect(trill.set.mock.calls.map(([is_on]) => is_on)).toEqual([true, false])
		expect(trill.typed).toHaveBeenCalledOnce()
	})
})
