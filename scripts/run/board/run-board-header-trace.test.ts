import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_header_defcon } from './run-board-header-defcon'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8354: the matrix theme's `TRACE` gauge — one more cell filled per level nearer 1,
// at the level `DEFCON` reads, and the whole field blinking red at 1.

const { SHADES, field_of } = run_board_header_trace
const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { THEME_DEFS } = run_board_theme_defs
const ESCAPE = '\u{1B}['
const BLINK = `${ESCAPE}5m`
const RED = `${ESCAPE}38;2;255;69;58m`
const NAMED_GREEN = `${ESCAPE}32m`
const HALTED = 1
const CALM = 5

function header_line(extra: Partial<BoardHeader>): string {
	const board = header({ layout: EMPTY_LAYOUT, lane_limit: 3, theme: 'matrix', ...extra })

	return stripVTControlCharacters(run_board_header.header_lines(board)[0] ?? '')
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('run_board_header_trace.field_of', () => {
	it.each([
		[5, 'TRACE ■----'],
		[4, 'TRACE ■■---'],
		[3, 'TRACE ■■■--'],
		[2, 'TRACE ■■■■-'],
		[1, 'TRACE ■■■■■'],
	])('fills the cells for level %i', (level, text) => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(field_of(level)).toBe(text)
	})

	it('draws the filled cells bright and the rest dark in 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(field_of(2)).toContain(`${ESCAPE}38;2;${SHADES.bright.rgb}m■■■■`)
		expect(field_of(2)).toContain(`${ESCAPE}38;2;${SHADES.dark.rgb}m-`)
		expect(field_of(2)).not.toContain(BLINK)
	})

	it('falls back to the palette green without 24-bit color', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(field_of(CALM)).toContain(`${NAMED_GREEN}■`)
	})

	it('blinks the whole field in the failure red at level 1', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(field_of(HALTED)).toBe(`${BLINK}${RED}TRACE ■■■■■${ESCAPE}39m${ESCAPE}25m`)
	})
})

describe('run_board_header_trace.SHADES', () => {
	it('holds the matrix palette, each falling back to green', () => {
		expect(Object.values(SHADES).map((shade) => shade.rgb)).toStrictEqual([
			'0;255;65',
			'0;215;60',
			'0;165;40',
			'0;100;22',
			'0;55;12',
			'225;255;225',
		])
		expect(new Set(Object.values(SHADES).map((shade) => shade.named))).toStrictEqual(
			new Set(['green']),
		)
	})
})

describe('run_board_header.header_lines with the matrix theme', () => {
	it('ends the screen header first line on TRACE at the level DEFCON reads', () => {
		const alert = vi.spyOn(THEME_DEFS.matrix, 'alert')
		const held = { read_failed_ms: NOW }

		expect(header_line({})).toMatch(/ {2}TRACE ■----$/u)
		expect(header_line(held)).toMatch(/ {2}TRACE ■■■■■$/u)
		expect(alert.mock.calls).toStrictEqual([
			[run_board_header_defcon.level_of(header({ layout: EMPTY_LAYOUT, lane_limit: 3 }))],
			[HALTED],
		])
		expect(header_line({ form: 'chat' })).not.toContain('TRACE')
	})
})
