import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_ending } from './run-board-theme-codec-ending'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'

// joshuafolkken/kit#8917: the METAL GEAR ending, the codec signing off.

const { MG_END, drifting_freq, ending_of, mg_sign_off_look } = run_board_theme_codec_ending
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { state_of } = run_board_theme_host_state
const IDLE = { notice: [], progress: [], row: [] }
const codec = run_board_theme_codec_context.codec_of(HOST.api)

describe('run_board_theme_codec_ending.mg_sign_off_look', () => {
	it('talks until the voice drops, then falls away from 6 to nothing', () => {
		expect(mg_sign_off_look(0).is_lit).toBe(true)
		expect(mg_sign_off_look(MG_END.drop)).toMatchObject({ is_lit: false, level: 6 })
		expect(mg_sign_off_look(MG_END.drop + 20).level).toBe(0)
	})

	it('drifts the frequency off from its last digit back', () => {
		expect(drifting_freq(MG_END.drop)).toBe('140.85')
		expect(drifting_freq(MG_END.drop + 2).slice(0, 4)).toBe('140.')
		expect(drifting_freq(MG_END.drop + 12)).toMatch(/^\d{3}\.\d{2}$/u)
	})
})

describe('run_board_theme_codec_ending.ending_of', () => {
	it('ends on an empty screen', () => {
		const ending = ending_of(codec)
		const grid = HOST.api.board.map((row) => [...row])
		const empty = Array.from({ length: HOST.layout.h }, () => row_of('', 'body', HOST.layout.w))

		ending.draw(grid, MG_END.gone, state_of(HOST.layout, IDLE, 0))

		expect(ending.ticks).toBe(90)
		expect(grid).toStrictEqual(empty)
	})
})
