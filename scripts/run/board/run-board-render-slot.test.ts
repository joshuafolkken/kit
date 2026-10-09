import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_slot } from './run-board-render-slot'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3554: the column between a row's time and its track — a running row's usage, a
// finished row's finish time, blanks on any other — one width on every row.

const { cell_of, column_width, slot_of } = run_board_render_slot
const { MINUTE, NOW } = run_board_render_fixture
const GB = 1024 * 1024 * 1024
const FINISH = /^🔚 \d{2}:\d{2}$/u

function row(number: number, state: BoardRow['state'], ended_ms?: number): BoardRow {
	const status = { state, started_ms: NOW - MINUTE, ended_ms, track: [] }

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

const usages: LaneUsages = new Map([
	[1, { cpu_percent: 20, memory_bytes: 1.6 * GB, memory_percent: 9 }],
])

describe('run_board_render_slot.slot_of', () => {
	it('draws a running row’s usage', () => {
		const drawn = slot_of(row(1, 'running'), usages, NOW) ?? ''

		expect(stripVTControlCharacters(drawn)).toBe('⚡ 20% 🧠1.6G')
	})

	it('draws a merged or done row’s finish time', () => {
		expect(slot_of(row(2, 'merged', NOW - MINUTE), usages, NOW)).toMatch(FINISH)
		expect(slot_of(row(3, 'done', NOW - MINUTE), usages, NOW)).toMatch(FINISH)
	})

	it('draws nothing on a finished row with no end, a running row with no usage, or any other row', () => {
		expect(slot_of(row(2, 'merged'), usages, NOW)).toBeUndefined()
		expect(slot_of(row(4, 'running'), usages, NOW)).toBeUndefined()
		expect(slot_of(row(5, 'stopped', NOW - MINUTE), usages, NOW)).toBeUndefined()
	})
})

describe('run_board_render_slot.column_width', () => {
	it('is the widest any row draws, as the terminal counts it', () => {
		const running = row(1, 'running')
		const rows = [running, row(2, 'merged', NOW - MINUTE), row(5, 'stopped')]
		const widest = run_board_fit.width_of(slot_of(running, usages, NOW) ?? '')

		expect(column_width(rows, usages, NOW)).toBe(widest)
	})

	it('is zero when no row draws in the column', () => {
		expect(column_width([row(5, 'stopped')], usages, NOW)).toBe(0)
		expect(column_width([], usages, NOW)).toBe(0)
	})
})

describe('run_board_render_slot.cell_of', () => {
	it('pads a row’s text with blanks to the column width', () => {
		expect(cell_of('🔚 14:05', 9)).toBe('🔚 14:05 ')
	})

	it('fills a row that draws nothing with blanks only', () => {
		expect(cell_of(undefined, 3)).toBe(' '.repeat(3))
	})

	it('never trims text wider than the column', () => {
		expect(cell_of('abcd', 2)).toBe('abcd')
	})
})
