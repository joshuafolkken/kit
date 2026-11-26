import { describe, expect, it } from 'vitest'
import { run_board_theme_codec } from './run-board-theme-codec'
import { run_board_theme_codec_face_cells } from './run-board-theme-codec-face-cells'
import { run_board_theme_codec_talk } from './run-board-theme-codec-talk'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_snap_fixture } from './run-board-theme-host-snap-fixture'

// joshuafolkken/kit#8917: the codec theme's PROGRESS call, drawn inside the panel only (the confirmed
// specification §4, the demo's v22).

const { bar_color, display_w, face_look, panel_bars } = run_board_theme_codec_talk
const { BUST } = run_board_theme_codec_face_cells
const { HOST } = run_board_theme_host_fixture
const { frame_at, theme_of } = run_board_theme_host_snap_fixture
const { area_end, area_top, px } = HOST.layout
const CALL_TICKS = [12, 30, 45]

// The characters of the area left of the panel (an event may tint the idle drawing there).
function area_left(frame: ReturnType<typeof frame_at>): string {
	return frame
		.slice(area_top + 1, area_end + 1)
		.map((row) =>
			row
				.slice(0, px)
				.map(([ch]) => ch)
				.join(''),
		)
		.join('\n')
}

function area_panel(frame: ReturnType<typeof frame_at>): string {
	return JSON.stringify(frame.slice(area_top + 1, area_end + 1).map((row) => row.slice(px)))
}

describe('run_board_theme_codec_talk parts', () => {
	it('leaves the display the panel less a bust and a gap at either end', () => {
		expect(display_w(60)).toBe(60 - 2 * BUST.columns - 2)
	})

	it('lays two whole bars, then eight stubs, ten in all', () => {
		const bars = panel_bars(30)

		expect(bars).toHaveLength(10)
		expect(bars.slice(0, 2)).toStrictEqual([30, 30])
		expect(bars.slice(2).every((stub) => stub < 30)).toBe(true)
	})

	it('lights the bars from the bottom up with the voice level', () => {
		const bars = panel_bars(30)
		const lit = bars.map((_, index) => bar_color(bars, 3, index))

		expect(lit.at(-1)).not.toBe(lit[0])
		expect(bar_color(bars, 10, 0)).not.toBe(bar_color(bars, 0, 0))
	})

	it('opens the mouth only while talking, and blinks now and then', () => {
		expect(face_look(false, 0)).toMatchObject({ is_talking: false, is_open: false })
		expect(face_look(true, 0)).toMatchObject({ is_talking: true, is_open: true })
		expect(face_look(true, 2).is_open).toBe(false)
		expect(face_look(false, 0).is_blink).toBe(true)
		expect(face_look(false, 10).is_blink).toBe(false)
	})
})

describe('run_board_theme_codec_talk in the theme', () => {
	it.each(CALL_TICKS)(
		'draws PROGRESS at tick %i inside the panel, the area’s left kept',
		(tick) => {
			const theme = theme_of(run_board_theme_codec.theme)
			const call = frame_at(theme, 'p', tick)
			const idle = frame_at(theme, 'i', tick)

			expect(area_left(call)).toBe(area_left(idle))
			expect(area_panel(call)).not.toBe(area_panel(idle))
		},
	)
})
