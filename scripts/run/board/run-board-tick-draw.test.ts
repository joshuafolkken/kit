import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_header } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { CueName } from './run-board-sound-cues'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { bounds_of, draw_run } = run_board_tick_draw
const SIZE = { rows: 15, columns: 80 }
const FOOTER = ['footer']
const BASELINE = 7
const HEADER_LINES = 3
const SECOND = 1000
// Past the time the header's now line takes to type through.
const TYPED_MS = 10 * SECOND

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

describe('run_board_tick_draw.draw_run', () => {
	it('pins the baseline total to the first count the plan gives and writes one frame', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state = planned()
		const run_layout = layout_for(state, LOCAL, START)
		const drawn = draw_run(state, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBe(run_board_header.counts_of(run_layout).total)
		expect(frames).toHaveLength(1)
	})

	it('keeps a baseline already pinned', () => {
		const { ports } = harness(LOCAL, [])
		const state = { ...planned(), baseline_total: BASELINE }
		const run_layout = layout_for(state, LOCAL, START)
		const drawn = draw_run(state, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBe(BASELINE)
	})

	it('pins no baseline before the plan is read', () => {
		const { ports } = harness(LOCAL, [])
		const run_layout = layout_for(FRESH_STATE, LOCAL, START)
		const drawn = draw_run(FRESH_STATE, LOCAL, { ports, now_ms: START }, run_layout)

		expect(drawn.baseline_total).toBeUndefined()
	})
})

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

// A redraw over `rows`, its cues recorded in `cues`.
function drawn_over(
	state: BoardState,
	rows: ReadonlyArray<BoardRow>,
	cues: Array<CueName>,
): BoardState {
	const { ports } = harness(LOCAL, [])
	const run_layout = { ...layout_for(state, LOCAL, START), active: rows }

	function cue(name: CueName): void {
		cues.push(name)
	}

	return draw_run(state, LOCAL, { ports: { ...ports, cue }, now_ms: START }, run_layout)
}

// joshuafolkken/kit#7951: the live board sounds the cue a redraw picks over the last frame's.
describe('run_board_tick_draw.draw_run cue', () => {
	it('sounds a launch once on the redraw a lane starts on, and not again while it runs', () => {
		const cues: Array<CueName> = []
		const before = drawn_over(planned(), [], cues)
		const launched = drawn_over(before, [row(1, 'running')], cues)

		drawn_over(launched, [row(1, 'running')], cues)

		expect(cues).toStrictEqual(['launch'])
	})

	it('sounds nothing on the first redraw over a wait on a person and a stopped lane', () => {
		const cues: Array<CueName> = []
		const drawn = drawn_over(planned(), [row(1, 'human'), row(2, 'stopped')], cues)

		expect(cues).toStrictEqual([])
		expect(drawn.sound_snapshot).toBeDefined()
	})

	it('sounds nothing on the redraw the plan arrives on with a wait already there', () => {
		const cues: Array<CueName> = []
		const before = drawn_over({ ...planned(), plan: undefined }, [], cues)

		drawn_over({ ...before, plan: plan_titled('a') }, [row(1, 'human')], cues)

		expect(before.sound_snapshot).toBeUndefined()
		expect(cues).toStrictEqual([])
	})
})

// The header's three lines a live redraw writes with the sound switch at `is_on`.
function header_drawn(is_on: boolean): Array<string> {
	const { ports, frames } = harness(LOCAL, [])
	const state = planned()

	draw_run(
		state,
		LOCAL,
		{ ports: { ...ports, sound: () => is_on }, now_ms: START },
		layout_for(state, LOCAL, START),
	)

	return stripVTControlCharacters(frames.join('')).split('\n').slice(0, HEADER_LINES)
}

// joshuafolkken/kit#7952: the live header says whether the board sounds its cues.
describe('run_board_tick_draw.draw_run sound mark', () => {
	it('draws 🔊 after josh-board while the sound is on, the lines under it aligned', () => {
		expect(header_drawn(true)).toStrictEqual([
			'⏸ josh-board 🔊  ⏰ 0″  ✅  0/- ──────────  🔄 0  ⏳ -  💤 0',
			'  -                     💪 -  🧠 -  💾 -',
			'  kit',
		])
	})

	it('draws 🔇 after josh-board while the sound is off', () => {
		expect(header_drawn(false)[0]).toMatch(/^⏸ josh-board 🔇 {2}⏰/u)
	})
})

// A themed redraw over `rows` at `now_ms`, typing the rows and the header's now line.
function typed_over(state: BoardState, rows: ReadonlyArray<BoardRow>, now_ms: number): BoardState {
	const { ports } = harness(LOCAL, [])
	const run_layout = { ...layout_for(state, LOCAL, START), active: rows }

	return draw_run(state, LOCAL, { ports: { ...ports, types_rows: true }, now_ms }, run_layout)
}

function typing_keys(state: BoardState): Array<string> {
	return state.typing.lines.map((line) => line.key)
}

// joshuafolkken/kit#8103: the header's now line types when its words change, and not again while they
// stay — its key is known to the next frame.
describe('run_board_tick_draw.draw_run now line typing', () => {
	it('types the now line once its words appear, and not again on a later redraw', () => {
		const now_key = 'now:1 running'
		const running = [row(1, 'running')]
		const base = typed_over(planned(), [], START)
		const appeared = typed_over(base, running, START + SECOND)
		const later = typed_over(appeared, running, START + TYPED_MS)

		expect(typing_keys(appeared)).toContain(now_key)
		expect(typing_keys(later)).not.toContain(now_key)
	})
})

describe('run_board_tick_draw.bounds_of', () => {
	it('reads the pane size, footer and folded sections off the ports', () => {
		const { ports } = harness(LOCAL, [])
		const folded = new Set<never>()
		const bounds = bounds_of({ ...ports, size: () => SIZE, footer: FOOTER, folded: () => folded })

		expect(bounds).toStrictEqual({ size: SIZE, footer: FOOTER, folded })
	})

	it('leaves every bound unset on ports with none', () => {
		const { ports } = harness(LOCAL, [])
		const bare = { ...ports, size: undefined, footer: undefined, folded: undefined }

		expect(bounds_of(bare)).toStrictEqual({ size: undefined, footer: undefined, folded: undefined })
	})
})
