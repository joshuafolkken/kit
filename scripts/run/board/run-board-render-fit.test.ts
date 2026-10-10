import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render, type BoardView } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3505: a short pane takes the footer and the legend first, then the finished rows,
// and keeps the running rows longest; a frame with no pane is drawn whole, footer and all.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, note } = run_board_render_fixture
const FOOTER = ['', 'footer']
const WIDE = 500

function row(number: number, state: ItemState, started_minute: number): BoardRow {
	const started_ms = STARTED + started_minute * MINUTE
	const ended_ms = state === 'running' ? undefined : started_ms + MINUTE
	const status = { state, started_ms, ended_ms }

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

// Running and merged rows mixed as they started, and three notes. One cut row or note only trades its
// line for a `more N` line, so each stage has two to show a cut that saves a row.
const VIEW: BoardView = {
	header: header({
		layout: {
			...EMPTY_LAYOUT,
			active: [
				row(1, 'running', 0),
				row(2, 'merged', 10),
				row(3, 'running', 20),
				row(4, 'merged', 30),
			],
		},
	}),
	notes: [note(NOW, 'newest'), note(NOW - MINUTE, 'middle'), note(NOW - 2 * MINUTE, 'oldest')],
	footer: FOOTER,
}

function frame(rows: number | undefined): Array<string> {
	const size = rows === undefined ? undefined : { rows, columns: WIDE }

	return run_board_render.render({ ...VIEW, size }).map((line) => stripVTControlCharacters(line))
}

function has(lines: ReadonlyArray<string>, text: string): boolean {
	return lines.some((line) => line.includes(text))
}

// The tallest frame that has given `text` way.
function first_without(text: string): Array<string> {
	const tallest = frame(undefined).length
	const heights = Array.from({ length: tallest }, (_, index) => tallest - index)
	const rows = heights.find((height) => !has(frame(height), text)) ?? 0

	return frame(rows)
}

describe('run_board_render.render in a short pane', () => {
	it('ends a frame the pane holds on its footer, and drops the footer first', () => {
		const whole = frame(undefined)

		expect(frame(whole.length)).toStrictEqual(whole)
		expect(whole.slice(-2)).toStrictEqual(FOOTER)
		expect(frame(whole.length - 1)).toStrictEqual(whole.slice(0, -2))
	})

	it('cuts the finished rows while the running rows and the notes stay', () => {
		const lines = first_without('Issue 2')
		const kept = ['Issue 1', 'Issue 3', 'newest', 'oldest']

		expect(has(lines, 'Issue 4')).toBe(false)
		expect(kept.map((text) => has(lines, text))).toStrictEqual([true, true, true, true])
		expect(lines).toContain('  more 2')
	})

	it('cuts the oldest note before the newer, and the earlier running row before the later', () => {
		expect(has(first_without('oldest'), 'newest')).toBe(true)
		expect(has(first_without('Issue 1'), 'Issue 3')).toBe(true)
		expect(has(first_without('Issue 3'), 'Issue 1')).toBe(false)
	})
})

describe('run_board_render.render_no_run with a footer', () => {
	it('ends on the footer where the pane holds it, and gives it way where it does not', () => {
		const tall = run_board_render.render_no_run(NOW, {
			size: { rows: 3, columns: WIDE },
			footer: FOOTER,
		})
		const short = run_board_render.render_no_run(NOW, {
			size: { rows: 2, columns: WIDE },
			footer: FOOTER,
		})

		expect(tall.slice(1)).toStrictEqual(FOOTER)
		expect(short).toHaveLength(1)
	})
})
