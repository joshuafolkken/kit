import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardRow } from './run-board-layout'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const SECOND = 1000
// Past the time the header's notice takes to type through.
const TYPED_MS = 10 * SECOND
const RUNNING: ReadonlyArray<BoardRow> = [
	{ number: 1, title: undefined, kind: undefined, state: 'running', status: undefined, waits: [] },
]

interface Typed {
	is_on: boolean
	rows: ReadonlyArray<BoardRow>
	now_ms: number
}

// A themed redraw over `rows` at `now_ms` with the sound switch at `is_on`.
function typed_over(state: BoardState, { is_on, rows, now_ms }: Typed): BoardState {
	const { ports } = harness(LOCAL, [])
	const typing = { ...ports, types_rows: true, sound: (): boolean => is_on }
	const run_layout = { ...layout_for(state, LOCAL, START), active: rows }

	return drawn_from(state, LOCAL, { ports: typing, now_ms }, run_layout)
}

function notice_keys(state: BoardState): Array<string> {
	return state.typing.lines.map((line) => line.key).filter((key) => key.startsWith('notice:'))
}

// joshuafolkken/kit#8114: the header's last notice types when it changes, and not again while it stays,
// nor when only the sound switch flips.
describe('run_board_tick_draw.draw_display notice typing', () => {
	const planned = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const base = typed_over(planned, { is_on: true, rows: [], now_ms: START })
	const launched = typed_over(base, { is_on: true, rows: RUNNING, now_ms: START + SECOND })
	const later = typed_over(launched, { is_on: true, rows: RUNNING, now_ms: START + TYPED_MS })

	it('types a new notice', () => {
		expect(notice_keys(launched)).toHaveLength(1)
		expect(notice_keys(launched)[0]).toMatch(/^notice:🔄 #1 \d{2}:\d{2}$/u)
	})

	it('types it not again on a later redraw, nor when the sound is switched off', () => {
		const muted = typed_over(later, {
			is_on: false,
			rows: RUNNING,
			now_ms: START + TYPED_MS + SECOND,
		})

		expect(notice_keys(later)).toStrictEqual([])
		expect(notice_keys(muted)).toStrictEqual([])
	})
})
