import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render, type BoardView } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3505: a short pane takes the footer and the legend first, then the finished rows,
// and keeps the running rows longest; a frame with no pane is drawn whole, footer and all.
// joshuafolkken/kit#4042: the finished rows fold from the oldest into their own section's count.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, note, rule } = run_board_render_fixture
const FOOTER = ['', 'footer']
const WIDE = 500

function row(number: number, state: ItemState, started_minute: number): BoardRow {
	const started_ms = STARTED + started_minute * MINUTE
	const ended_ms = state === 'running' ? undefined : started_ms + MINUTE
	const status = { state, started_ms, ended_ms }

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

// Running and finished rows mixed as they started, and three notes. One cut row or note only trades its
// line for a `more N` line, so each stage has two to show a cut that saves a row — the finished rows
// three, the oldest of them withdrawn.
const VIEW: BoardView = {
	header: header({
		layout: {
			...EMPTY_LAYOUT,
			active: [
				row(1, 'running', 0),
				row(2, 'withdrawn', 10),
				row(3, 'running', 20),
				row(4, 'merged', 30),
				row(5, 'merged', 40),
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

	it('folds the oldest finished rows into the done count while the newest one stays', () => {
		const lines = first_without('Issue 2')
		const kept = ['Issue 1', 'Issue 3', 'Issue 5', 'newest', 'oldest']
		const newest = lines.findIndex((line) => line.includes('Issue 5'))

		expect(has(lines, 'Issue 4')).toBe(false)
		expect(kept.map((text) => has(lines, text))).toStrictEqual([true, true, true, true, true])
		expect(lines[newest - 1]).toBe(rule('✅ done'))
		expect(lines[newest + 1]).toBe('  ✅ 2 more  🚫 1')
		expect(has(lines, '  more')).toBe(false)
	})

	it('drops the done section once its last row is cut, counting the rows on the plan’s more', () => {
		const lines = first_without('Issue 5')

		expect(has(lines, '✅ done')).toBe(false)
		expect([has(lines, 'Issue 1'), has(lines, 'Issue 3')]).toStrictEqual([true, true])
		expect(lines).toContain('  more 3')
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
