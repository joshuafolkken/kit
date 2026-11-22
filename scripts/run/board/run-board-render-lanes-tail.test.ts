import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_theme } from './run-board-theme'

// joshuafolkken/kit#8514: the run's tallies end the lanes rule, not the header's first line, which a
// narrow pane cuts; no bar and no `(+N)`. A pane with no room for them leaves them out rather than
// running the rule past its edge.

const { EMPTY_LAYOUT, header, lines_of } = run_board_render_fixture
const TALL = 200
const WIDE = 160
// The narrowest pane the fixture's lanes rule and its tallies fit in.
const FITTING = 50

function row(number: number, state: BoardRow['state']): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state,
		status: undefined,
		kind: undefined,
		waits: [],
	}
}

const LAYOUT = {
	...EMPTY_LAYOUT,
	active: [row(1, 'merged'), row(2, 'running')],
	unreached: [row(3, 'waiting')],
}

function lanes_rule(lines: ReadonlyArray<string>): string {
	return lines.find((line) => / lanes /iu.test(line)) ?? ''
}

// The board as a pane `columns` wide draws it.
function rendered(board: BoardHeader, columns: number): Array<string> {
	return run_board_render
		.render({ header: board, notes: [], size: { rows: TALL, columns }, folded: new Set() })
		.map((line) => stripVTControlCharacters(line))
}

describe('run_board_render.render lanes tail', () => {
	it('ends the lanes rule on the tallies, with no bar and no arrivals on the first line', () => {
		const lines = lines_of(header({ layout: LAYOUT }))

		expect(lanes_rule(lines)).toMatch(/─ ✅ 1\/3 {2}🔄 1 {2}💤 0$/u)
		expect(lines[0]).not.toMatch(/[✅🔄💤]|\(\+\d+\)/u)
	})

	it('keeps the lanes rule’s columns before the tallies', () => {
		const tailed = lanes_rule(lines_of(header({ layout: LAYOUT })))
		const plain = lanes_rule(
			lines_of(header({ layout: LAYOUT, plan_fetched_ms: undefined, repo: undefined })),
		)
		const lead = tailed.slice(0, tailed.indexOf('⏰') + 1)

		expect(plain.startsWith(lead)).toBe(true)
	})

	it('keeps the tallies on a folded lanes rule', () => {
		const folded = new Set(['lanes'] as const)
		const lines = run_board_render
			.render({ header: header({ layout: LAYOUT }), notes: [], folded })
			.map((line) => stripVTControlCharacters(line))

		expect(lanes_rule(lines)).toMatch(/^▸ .* ✅ 1\/3 {2}🔄 1 {2}💤 0$/u)
	})
})

describe('run_board_render.render lanes tail in a pane', () => {
	it('runs the tallies past the rule while they stay within the pane', () => {
		const rule = lanes_rule(rendered(header({ layout: LAYOUT }), FITTING))

		expect(rule).toMatch(/─ ✅ 1\/3 {2}🔄 1 {2}💤 0$/u)
		expect(run_board_fit.width_of(rule)).toBe(FITTING)
	})

	it('leaves the tallies out where they would run past the pane', () => {
		const rule = lanes_rule(rendered(header({ layout: LAYOUT }), FITTING - 1))

		expect(rule).not.toContain('✅')
		expect(rule).toMatch(/─$/u)
	})

	it('draws the tallies and the issue count in a theme’s words', () => {
		const issue_count = { open: 78, closed: 4489 }
		const board = header({ layout: LAYOUT, theme: 'wargames', repo: 'o/r', issue_count })
		const frame = run_board_theme.restyle('wargames', rendered(board, WIDE).join('\n'), 'letters')

		expect(lanes_rule(frame.split('\n'))).toMatch(/ OK 1\/3 {2}RN 1 {2}ZZ 0 {2}IS 78\/4,489$/u)
	})
})
