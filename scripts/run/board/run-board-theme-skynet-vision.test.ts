import { describe, expect, it } from 'vitest'
import { run_board_theme_skynet_data } from './run-board-theme-skynet-data'
import { run_board_theme_skynet_fixture } from './run-board-theme-skynet-fixture'
import { run_board_theme_skynet_vision } from './run-board-theme-skynet-vision'

// joshuafolkken/kit#8917: the TERMINATOR theme's crosshair and red vignette.

const { band_sweep, crosshair, crosshair_center, vignette } = run_board_theme_skynet_vision
const { INKS } = run_board_theme_skynet_data
const { HOST, draw_at } = run_board_theme_skynet_fixture
const RGB = /^\d+;\d+;\d+$/u

describe('run_board_theme_skynet_vision', () => {
	it('starts the crosshair at the bottom left of the notice and closes on its row', () => {
		const { notice, h } = HOST.layout

		expect(crosshair_center(HOST.layout, 0)).toStrictEqual({ y: h - 1, x: notice.x })
		expect(crosshair_center(HOST.layout, 1).y).toBe(notice.y)
	})

	it('crosses the screen while the notice types', () => {
		const draw = draw_at('n', 30)
		const center = crosshair_center(HOST.layout, draw.s.notice.length / draw.s.notice.total)

		crosshair(draw)

		expect(draw.grid[0]?.[center.x]?.[1]).toBe(INKS.CROSS)
	})

	it('rolls a bright head and a dimmer row behind it', () => {
		expect(band_sweep(HOST.layout, 0, 0)).toBe(55)
		expect(band_sweep(HOST.layout, HOST.layout.h + 13, 0)).toBe(28)
		expect(band_sweep(HOST.layout, 5, 0)).toBe(0)
	})

	it('washes in red, brighter at the centre than the corner', () => {
		const { s } = draw_at('i', 5)
		const center = vignette(HOST.layout, { y: 31, x: 99 }, 5, s)
		const corner = vignette(HOST.layout, { y: 31, x: 0 }, 5, s)

		expect(center).toMatch(RGB)
		expect(Number(center.split(';', 1)[0])).toBeGreaterThan(Number(corner.split(';', 1)[0]))
	})
})
