import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_slot, type UsageSlot } from './run-board-render-slot'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3554: the column between a row's time and its track — a running row's usage, a
// finished row's finish time, blanks on any other — one width on every row.

const { GAUGE_SHADES, painted } = run_board_labels
const { cell_of, column_width, slot_of, usage_slot } = run_board_render_slot
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
const slot: UsageSlot = { usages, running: 1 }

// Lane 1's memory figure, as drawn among `rows`.
function memory_of(rows: ReadonlyArray<BoardRow>): string {
	const drawn = slot_of(row(1, 'running'), usage_slot(rows, usages), NOW) ?? ''

	return drawn.split('🧠', 2)[1] ?? ''
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_slot.usage_slot', () => {
	it('counts the frame’s running rows, none of its waiting or finished ones', () => {
		const rows = [row(1, 'running'), row(2, 'running'), row(3, 'merged'), row(4, 'stopped')]

		expect(usage_slot(rows, usages)).toStrictEqual({ usages, running: 2 })
	})
})

// joshuafolkken/kit#3612: a lane's colors follow the frame's running count.
describe('run_board_render_slot.slot_of', () => {
	it('draws a running row’s usage', () => {
		const drawn = slot_of(row(1, 'running'), slot, NOW) ?? ''

		expect(stripVTControlCharacters(drawn)).toBe('⚡ 20% 🧠1.6G')
	})

	it('shades a running row against the share of the frame’s running rows', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const alone = [row(1, 'running')]
		const crowded = [...alone, ...[2, 3, 4, 5, 6, 7, 8].map((number) => row(number, 'running'))]

		expect(memory_of(alone)).toBe(painted(GAUGE_SHADES.normal, '1.6G'))
		expect(memory_of(crowded)).toBe(painted(GAUGE_SHADES.red, '1.6G'))
	})

	it('draws a merged or done row’s finish time', () => {
		expect(slot_of(row(2, 'merged', NOW - MINUTE), slot, NOW)).toMatch(FINISH)
		expect(slot_of(row(3, 'done', NOW - MINUTE), slot, NOW)).toMatch(FINISH)
	})

	it('draws nothing on a finished row with no end, a running row with no usage, or any other row', () => {
		expect(slot_of(row(2, 'merged'), slot, NOW)).toBeUndefined()
		expect(slot_of(row(4, 'running'), slot, NOW)).toBeUndefined()
		expect(slot_of(row(5, 'stopped', NOW - MINUTE), slot, NOW)).toBeUndefined()
	})
})

describe('run_board_render_slot.column_width', () => {
	it('is the widest any row draws, as the terminal counts it', () => {
		const running = row(1, 'running')
		const rows = [running, row(2, 'merged', NOW - MINUTE), row(5, 'stopped')]
		const widest = run_board_fit.width_of(slot_of(running, slot, NOW) ?? '')

		expect(column_width(rows, slot, NOW)).toBe(widest)
	})

	it('is zero when no row draws in the column', () => {
		expect(column_width([row(5, 'stopped')], slot, NOW)).toBe(0)
		expect(column_width([], slot, NOW)).toBe(0)
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
