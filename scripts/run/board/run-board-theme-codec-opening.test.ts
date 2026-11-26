import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_opening } from './run-board-theme-codec-opening'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#8917: the METAL GEAR opening, a codec call coming in.

const { MG_OPEN, frame_corners, mg_call_look, opening_of } = run_board_theme_codec_opening
const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const IDLE = { notice: [], progress: [], row: [] }
const codec = run_board_theme_codec_context.codec_of(HOST.api)

describe('run_board_theme_codec_opening.mg_call_look', () => {
	it('blinks CALL as the meter rises, then holds PTT on 140.85', () => {
		expect(mg_call_look(0)).toMatchObject({ label: 'CALL', is_lit: true, level: 0 })
		expect(mg_call_look(4)).toMatchObject({ label: 'CALL', is_lit: false, level: 1 })
		expect(mg_call_look(39).level).toBe(10)
		expect(mg_call_look(MG_OPEN.ptt)).toMatchObject({ label: 'PTT', is_lit: true, freq: '140.85' })
	})
})

describe('run_board_theme_codec_opening.frame_corners', () => {
	it('opens from the codec out to the screen’s edges', () => {
		const { x, y } = codec.codec_at
		const first = frame_corners(codec, MG_OPEN.open - 1)
		const last = frame_corners(codec, MG_OPEN.close - 1)

		expect(first).toStrictEqual({ x0: x, y0: y, x1: x + 57, y1: y + 9 })
		expect(last).toStrictEqual({ x0: 0, y0: 0, x1: HOST.layout.w - 1, y1: HOST.layout.h - 1 })
	})
})

describe('run_board_theme_codec_opening.opening_of', () => {
	it('plays for six seconds and leaves the board alone at its end', () => {
		const opening = opening_of(codec)
		const grid = HOST.api.board.map((row) => [...row])

		opening.draw(grid, MG_OPEN.fade + 2, state_of(HOST.layout, IDLE, 0))

		expect(opening.ticks).toBe(120)
		expect(grid).toStrictEqual(HOST.api.board)
	})
})
