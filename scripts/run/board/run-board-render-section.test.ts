import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#4042: the running and parked rows lead with no rule, the finished ones gather
// under `✅ done` after every other plan section — the waves too — and before the findings, and the
// unreached rows wait under `🔗 waiting`.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of, note, rule } =
	run_board_render_fixture

function row(number: number, state: ItemState, started_minute?: number): BoardRow {
	const started_ms = started_minute === undefined ? undefined : STARTED + started_minute * MINUTE
	const ended_ms = started_ms === undefined || state === 'running' ? undefined : started_ms + MINUTE
	const status = started_ms === undefined ? undefined : { state, started_ms, ended_ms }

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

const LAYOUT = {
	...EMPTY_LAYOUT,
	active: [
		row(1, 'running', 0),
		row(2, 'parked', 5),
		row(3, 'merged', 30),
		row(4, 'withdrawn', 20),
		row(5, 'done', 10),
	],
	waves: [[{ kind: 'row' as const, row: row(8, 'waiting') }]],
	people: [row(6, 'human')],
	unreached: [row(7, 'waiting')],
}

function index_of(lines: ReadonlyArray<string>, text: string): number {
	return lines.findIndex((line) => line.includes(text))
}

describe('run_board_render.render sections', () => {
	const lines = lines_of(header({ layout: LAYOUT }), [note(NOW, 'finding')])
	const order = [
		'Issue 1',
		'Issue 2',
		rule('1'),
		'Issue 8',
		rule('🙋'),
		'Issue 6',
		rule('🔗 waiting'),
		'Issue 7',
		rule('✅ done'),
		'Issue 3',
		'Issue 4',
		'Issue 5',
		rule('📌'),
		'finding',
	]

	it('draws the leading rows, the plan sections, the done section and the findings in order', () => {
		const indexes = order.map((text) => index_of(lines, text))

		expect(indexes.every((index) => index !== -1)).toBe(true)
		expect(indexes).toStrictEqual(indexes.toSorted((left, right) => left - right))
	})

	it('draws every finished row and no fold line where no pane bounds the frame', () => {
		expect(lines.filter((line) => line.includes(' more'))).toStrictEqual([])
		expect(lines).not.toContain(rule('🔗'))
	})
})
