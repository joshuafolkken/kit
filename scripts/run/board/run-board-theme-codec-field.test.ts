import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_context } from './run-board-theme-codec-context'
import { run_board_theme_codec_field } from './run-board-theme-codec-field'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Grid, ThemeTimeline } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the METAL GEAR theme's field display, which ROW takes the area with.

const { contact_screen } = run_board_theme_codec_field
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { state_of } = run_board_theme_host_state
const ROW: ThemeTimeline = {
	notice: [],
	progress: [],
	row: [{ start: 0, text: HOST.layout.row_text }],
}

function screen_at(tick: number): Array<string> {
	const codec = run_board_theme_codec_context.codec_of(HOST.api)
	const grid: Grid = Array.from({ length: HOST.layout.h }, () => row_of('', 'body', HOST.layout.w))

	contact_screen(codec, { grid, s: state_of(HOST.layout, ROW, tick), tick })

	return grid.map((row) => row.map(([ch]) => ch).join(''))
}

describe('run_board_theme_codec_field.contact_screen', () => {
	it('lays out LIFE, the equipment boxes, the mission log and the radar', () => {
		const rows = screen_at(0)
		const top = rows[HOST.layout.area_top] ?? ''

		expect(top).toContain('LIFE')
		expect(top).toContain('── MISSION LOG')
		expect(top).toContain('┌─ RADAR')
		expect(rows[6]).toContain('┌─ LANES')
		expect(rows[6]).toContain('┌─ PICKED UP')
	})

	it('types the mission log a line at a time', () => {
		expect(screen_at(4).join('\n')).not.toContain('> CONTACT')
		expect(screen_at(30).join('\n')).toContain(`NEW LANE #${HOST.layout.new_lane}`)
		expect(screen_at(30).join('\n')).toContain('> STAGE')
	})

	it('steps the lane count up once the new lane arrives', () => {
		expect(screen_at(13)[10]).toContain(' ······ ')
		expect(screen_at(14)[10]).toContain(' IN USE ')
	})
})
