import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_header_time } from './run-board-header-time'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_spot } from './run-board-spot'
import { run_board_theme } from './run-board-theme'
import type { Theme } from './run-board-theme-defs'

// joshuafolkken/kit#8478: the header as time circuits — three lines of four columns, the names, the
// clocks, the signed times and the machine over the notice slot over what the run is doing now.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header } = run_board_render_fixture
const { minute_of } = run_board_labels
const HOUR = 60 * MINUTE
const SPINNER = '⠋'
const MACHINE = { cpu_percent: 15, memory_percent: 37, swap_mb_per_s: 3.1, memory_pressure: 1 }
const GAUGES = '💪  15% ■────  🧠  37% ■■───  💾 3.1M/s ■────'
const LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [
		{
			number: 1,
			title: undefined,
			kind: undefined,
			state: 'running',
			status: {
				state: 'running',
				track: ['implement'],
				phase_ms: NOW - 5 * MINUTE,
				started_ms: NOW - 5 * MINUTE,
			},
			waits: [],
		},
	],
}

function circuits(extra: Partial<BoardHeader> = {}): BoardHeader {
	return header({
		layout: LAYOUT,
		spinner: SPINNER,
		machine: MACHINE,
		usual: new Map<Phase, number>([['implement', 20 * MINUTE]]),
		lane_totals: [20 * MINUTE],
		lane_limit: 1,
		...extra,
	})
}

// The header as a live frame draws it: its placeholders drawn — the clocks' colons lit
// (joshuafolkken/kit#8476) — then the theme.
function drawn(board: BoardHeader, theme?: Theme): Array<string> {
	return run_board_header
		.header_lines({ ...board, theme })
		.map((line) => run_board_spot.drawn(line, SPINNER))
		.map((line) => stripVTControlCharacters(run_board_theme.restyle(theme, line)))
}

describe('run_board_header.header_lines time circuits', () => {
	it('draws a running run in three lines of four columns', () => {
		expect(drawn(circuits())).toStrictEqual([
			`▶ josh-board  🎯 ${minute_of(NOW + 15 * MINUTE)}  -  15′00″  ${GAUGES}`,
			`  -           🕒 ${minute_of(NOW)}  +2°10′00″  —`,
			`              🚀 ${minute_of(STARTED)}  ${SPINNER}          🔄 1 running`,
		])
	})

	it('draws an unknown finish --:-- over an unknown remainder', () => {
		const [first] = drawn(circuits({ lane_totals: [] }))

		expect(first).toBe(`▶ josh-board  🎯 --:--  -  --′--″  ${GAUGES}`)
	})

	it('draws an ended run’s end as its finish, nothing left and no spinner', () => {
		const ended_ms = NOW - MINUTE
		const lines = drawn(circuits({ ended_ms, layout: EMPTY_LAYOUT }))

		expect(lines[0]).toContain(`🎯 ${minute_of(ended_ms)}  -      0″`)
		expect(lines[1]).toContain(`🕒 ${minute_of(NOW)}  +2°09′00″`)
		expect(lines[2]).toContain(`🚀 ${minute_of(STARTED)}          —`)
		expect(lines[2]).not.toContain(SPINNER)
	})
})

describe('run_board_header.header_lines time circuits in a theme', () => {
	it.each(['wargames', 'matrix'] as const)('draws %s’s clocks ET / NW / T0', (theme) => {
		const lines = drawn(circuits(), theme)

		expect(lines[0]).toContain(`ET ${minute_of(NOW + 15 * MINUTE)}  -  15′00″`)
		expect(lines[1]).toContain(`NW ${minute_of(NOW)}  +2°10′00″`)
		// The theme draws its own spinner in the spinner's cell.
		expect(lines[2]).toMatch(
			new RegExp(String.raw`T0 ${minute_of(STARTED)}  \S {10}RN 1 RUNNING$`, 'u'),
		)
	})
})

describe('run_board_header_time.time_parts width', () => {
	it('keeps one sign column and the spinner’s cell however long the tool has run', () => {
		const now = { icon: '🔄', text: 'implementing', age_ms: 2 * HOUR }
		const cells = run_board_header_time.time_parts(circuits(), 'running', now, 15 * MINUTE)

		expect(cells.map((cell) => stripVTControlCharacters(cell))).toStrictEqual([
			'-  15′00″',
			'+2°10′00″',
			`${SPINNER}2°00′00″`,
		])
	})
})
