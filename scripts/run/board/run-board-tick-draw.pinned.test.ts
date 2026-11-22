import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardState } from './run-board-state'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8607: a redraw carries the pinned issues the board read into the header's panel.

const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, layout_for } = run_board_tick
const PIN = 8591

describe('run_board_tick_draw.draw_display pinned', () => {
	it('draws the pinned issues the state holds beside the header', () => {
		const { ports, frames } = harness(LOCAL, [])
		const state: BoardState = {
			...FRESH_STATE,
			plan: plan_titled('a'),
			run_started_ms: LOCAL.started_ms,
			pinned: [{ number: PIN, is_closed: false, closed_ms: undefined }],
		}

		drawn_from(state, LOCAL, { ports, now_ms: START }, layout_for(state, LOCAL, START))

		expect(stripVTControlCharacters(frames.join(''))).toContain(`⏳ ${String(PIN)} —`)
	})
})
