import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme } from './run-board-theme'
import { run_board_watch_panel } from './run-board-watch-panel'

// joshuafolkken/kit#8607: the watch panel over the header's first lines, ending on the rules' end.

const { GAP, MIN_HEADER_WIDTH, composed } = run_board_watch_panel
const { width_of } = run_board_fit
const { NOW, header, lines_of, rule } = run_board_render_fixture
const RULE_WIDTH = 80
const HEADER = ['▶ josh-board  🎯 11-22 12:23', '  v1.3473.0+362', '  kit  🚀 11-21 18:35']
const ROWS = ['✅ 8591 11:06', '⏳ 8353 —', '✅ 8505 10:18']
const PANEL_WIDTH = width_of(ROWS[0] ?? '')
const LIMIT = RULE_WIDTH - PANEL_WIDTH - GAP.length

describe('composed', () => {
	it('ends the widest pin line on the rules and starts every pin in one column', () => {
		const lines = composed(HEADER, ROWS, RULE_WIDTH)

		expect([0, 2].map((index) => width_of(lines.at(index) ?? ''))).toEqual([RULE_WIDTH, RULE_WIDTH])
		const columns = lines.map((line, index) => {
			const at = line.indexOf(ROWS[index] ?? '')

			return width_of(line.slice(0, at))
		})

		expect(new Set(columns)).toEqual(new Set([LIMIT + GAP.length]))
	})

	it('cuts a header line running into the panel with an ellipsis', () => {
		const long = `▶ ${'x'.repeat(RULE_WIDTH)}`
		const plain = stripVTControlCharacters(composed([long], ROWS, RULE_WIDTH).join(''))

		expect(plain).toBe(`${long.slice(0, LIMIT - 1)}…${GAP}${ROWS[0] ?? ''}`)
	})

	it('leaves the header as it is with no pins', () => {
		expect(composed(HEADER, [], RULE_WIDTH)).toEqual(HEADER)
	})

	it('leaves the header lines no pin sits beside as they are', () => {
		const lines = composed(HEADER, ROWS.slice(0, 1), RULE_WIDTH)

		expect(lines.slice(1)).toEqual(HEADER.slice(1))
		expect(lines[0]).toContain(ROWS[0])
	})

	it('leaves the header as it is on a board too narrow to keep its columns', () => {
		const narrow = MIN_HEADER_WIDTH + PANEL_WIDTH + GAP.length - 1

		expect(composed(HEADER, ROWS, narrow)).toEqual(HEADER)
	})
})

describe('the watch panel on the rendered board', () => {
	it('draws the pinned issues at the header right, the widest ending on the rules', () => {
		const pinned = [
			{ number: 8591, is_closed: true, closed_ms: NOW },
			{ number: 8353, is_closed: false, closed_ms: undefined },
		]
		const lines = run_board_render
			.render({ header: header(), notes: [], pinned })
			.map((line) => stripVTControlCharacters(line))

		expect(lines[0]?.endsWith(`✅ 8591 ${run_board_labels.minute_of(NOW)}`)).toBe(true)
		expect(width_of(lines[0] ?? '')).toBe(width_of(rule('x')))
		expect(lines[1]?.endsWith('⏳ 8353 —')).toBe(true)
		expect(lines.slice(2)).toEqual(lines_of(header()).slice(2))
	})
})

describe('composed in a theme', () => {
	it.each([
		['wargames', 'letters'],
		['wargames', 'shapes'],
		['matrix', 'letters'],
		['matrix', 'emoji'],
	] as const)('keeps the panel in its columns in the %s theme with %s icons', (theme, icons) => {
		const lines = composed(HEADER, ROWS, RULE_WIDTH)
		const themed = lines.map((line) => run_board_theme.restyle(theme, line, icons))

		expect(themed.map((line) => width_of(line))).toEqual(lines.map((line) => width_of(line)))
	})
})
