import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8117: a themed board types a findings / notes line the frame it first shows in, park
// reasons included, and not again — on a later frame, nor when it shows again after the pane hid it.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const { draw_run } = run_board_tick_draw
const KIND = run_event_stream.EVENT_KIND
const SECOND = 1000
// Past the time a line takes to type through.
const TYPED_MS = 10 * SECOND
const TALL = { rows: 60, columns: 80 }
// Too few rows for the findings section under the header.
const SHORT = { rows: 4, columns: 80 }
const PARKED = 42
const AT = new Date(START).toISOString()
const EVENTS: Array<RunEvent> = [
	{ pos: 1, at: AT, kind: KIND.PARK, text: `#${String(PARKED)} parked (a reason)` },
	{ pos: 2, at: AT, kind: KIND.NOTE, text: `#${String(PARKED)} an observation` },
]

function planned(): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
}

function parked_row(): BoardRow {
	return {
		number: PARKED,
		title: 'a title',
		kind: undefined,
		state: 'parked',
		status: undefined,
		waits: [],
	}
}

// A themed redraw at `now_ms` over the run's `events`, on a pane of `size`.
function drawn_over(
	state: BoardState,
	events: ReadonlyArray<RunEvent>,
	now_ms: number,
	size: typeof TALL,
): BoardState {
	const local: LocalRead = { ...LOCAL, events: [...events] }
	const { ports } = harness(local, [])
	const run_layout = { ...layout_for(state, local, START), active: [parked_row()] }
	const typing = { ...ports, types_rows: true, size: (): typeof TALL => size }

	return draw_run(state, local, { ports: typing, now_ms }, run_layout)
}

function note_keys(state: BoardState): Array<string> {
	return state.typing.lines.map((line) => line.key).filter((key) => key.startsWith('note:'))
}

describe('run_board_tick_draw.draw_run note line typing', () => {
	const base = drawn_over(planned(), [], START, TALL)
	const appeared = drawn_over(base, EVENTS, START + SECOND, TALL)

	it('types the park reason and the note that appear after the base frame', () => {
		expect(note_keys(base)).toStrictEqual([])
		expect(new Set(note_keys(appeared))).toStrictEqual(
			new Set([
				`note:note:${String(PARKED)}:${String(START)}`,
				`note:park:${String(PARKED)}:${String(START)}`,
			]),
		)
	})

	it('types them not again on a later redraw', () => {
		expect(note_keys(drawn_over(appeared, EVENTS, START + TYPED_MS, TALL))).toStrictEqual([])
	})

	it('types none on the base frame, and none the pane hid that shows again', () => {
		const hidden = drawn_over(planned(), EVENTS, START, SHORT)
		const shown = drawn_over(hidden, EVENTS, START + SECOND, TALL)

		expect(note_keys(hidden)).toStrictEqual([])
		expect(note_keys(shown)).toStrictEqual([])
	})
})
