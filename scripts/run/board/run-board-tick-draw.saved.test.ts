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
const HEADER_LINES = 3

function fetched_at(fetched_ms: number): BoardState {
	return { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms, fetched_ms }
}

// The header's lines a redraw writes over a plan read at `fetched_ms` on a board opened at `opened_ms`.
function header_over(fetched_ms: number, opened_ms: number | undefined): string {
	const { ports, frames } = harness(LOCAL, [])
	const state = fetched_at(fetched_ms)

	drawn_from(
		state,
		LOCAL,
		{ ports: { ...ports, opened_ms }, now_ms: START },
		layout_for(state, LOCAL, START),
	)

	return stripVTControlCharacters(frames.join('')).split('\n').slice(0, HEADER_LINES).join('\n')
}

describe('run_board_tick_draw.draw_display saved plan', () => {
	it('says 🕘 over a plan read before the board opened', () => {
		expect(header_over(START - SECOND, START)).toContain('🕘')
	})

	it('says no 🕘 over a plan read after the board opened', () => {
		expect(header_over(START, START - SECOND)).not.toContain('🕘')
	})

	it('says no 🕘 where the board has no opening moment', () => {
		expect(header_over(START - SECOND, undefined)).not.toContain('🕘')
	})
})
