import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8219: a plan read before the live board opened is the saved one it first drew, its
// age said with 🕘 until a fresh plan lands.

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const SECOND = 1000

function fetched_at(fetched_ms: number): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms, fetched_ms }
}

// The frame a redraw writes over a plan read at `fetched_ms` on a board opened at `opened_ms`.
function frame_over(fetched_ms: number, opened_ms: number | undefined): string {
	const { ports, frames } = harness(LOCAL, [])
	const state = fetched_at(fetched_ms)

	drawn_from(
		state,
		LOCAL,
		{ ports: { ...ports, opened_ms }, now_ms: START },
		layout_for(state, LOCAL, START),
	)

	return stripVTControlCharacters(frames.join(''))
}

// joshuafolkken/kit#8512: the age ends the queued rule, not the header's first line.
describe('run_board_tick_draw.draw_display saved plan', () => {
	it('says 🕘 at the queued rule’s end over a plan read before the board opened', () => {
		const frame = frame_over(START - SECOND, START)

		expect(frame).toMatch(/^.*queued.*─ 🕘 \S+$/mu)
		expect(frame.split('\n', 1)[0]).not.toContain('🕘')
	})

	it('says no 🕘 over a plan read after the board opened', () => {
		expect(frame_over(START, START - SECOND)).not.toContain('🕘')
	})

	it('says no 🕘 where the board has no opening moment', () => {
		expect(frame_over(START - SECOND, undefined)).not.toContain('🕘')
	})
})

// joshuafolkken/kit#8457: where the board types rows, the frame the live plan lands on types every line
// the saved plan's frame drew faint over its saved text at once.
describe('run_board_tick_draw.draw_display saved plan typed over', () => {
	const OPENED = START + SECOND
	const LANDED = START + 2 * SECOND

	// The typing a board opened at `OPENED` holds after a frame over the saved plan, then one over a plan
	// read after it opened, its rows typing where `types_rows` says.
	function landed(types_rows: boolean): BoardState['typing'] {
		const { ports } = harness(LOCAL, [])
		const typed_ports = { ...ports, opened_ms: OPENED, types_rows, theme: 'wopr' as const }
		const saved = fetched_at(START)
		const base = drawn_from(
			saved,
			LOCAL,
			{ ports: typed_ports, now_ms: OPENED },
			layout_for(saved, LOCAL, OPENED),
		)
		const live = { ...base, fetched_ms: LANDED }

		return drawn_from(
			live,
			LOCAL,
			{ ports: typed_ports, now_ms: LANDED },
			layout_for(live, LOCAL, LANDED),
		).typing
	}

	it('types the progress line over its saved text from the frame the live plan lands on', () => {
		const lines = landed(true).lines.filter((line) => line.under !== undefined)

		expect(lines.map((line) => [line.key.split(':', 1)[0], line.start_ms])).toStrictEqual([
			['plan', LANDED],
		])
	})

	it('types nothing where the board types no rows', () => {
		expect(landed(false).lines).toStrictEqual([])
	})
})
