import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { UsageFigure, UsageScale } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#4171: a lane row's and a processes row's CPU, MEM and CMPRS cells — a figure and
// a gauge each, the gauge's full width the whole machine at the header's thresholds.

const { GAUGE_SHADES, bar_of } = run_board_labels
const { cell_widths, cells_of, finish_of, plain_of } = run_board_usage_text
const GB = 1024 * 1024 * 1024
const GAUGE = 5
const SCALE: UsageScale = { cores: 10, total_bytes: 20 * GB }

function figure(cpu_cores: number | undefined, memory_gb = 1.6, compressed_gb = 0.5): UsageFigure {
	return { cpu_cores, memory_bytes: memory_gb * GB, compressed_bytes: compressed_gb * GB }
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_usage_text.cells_of', () => {
	it('draws each figure padded to its width, then its gauge over the whole machine', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(cells_of(figure(1.8), SCALE, GAUGE)).toStrictEqual([
			`18.0 ${bar_of(1.8, 10, GAUGE)}`,
			` 1.6 ${bar_of(1.6, 20, GAUGE)}`,
			` 0.5 ${bar_of(0.5, 20, GAUGE)}`,
		])
	})

	// joshuafolkken/kit#4220: CPU in the header's 💪 unit, a percentage of the whole machine.
	it('draws the CPU as a percentage of the machine’s cores, to one decimal', () => {
		const eleven: UsageScale = { cores: 11, total_bytes: 20 * GB }

		expect(cells_of(figure(6.2), eleven, 0)[0]).toBe('56.4')
		expect(cells_of(figure(0), eleven, 0)[0]).toBe(' 0.0')
	})

	it('draws a full machine as `100`, as wide as `99.9`', () => {
		expect(cells_of(figure(10), SCALE, 0)[0]).toBe(' 100')
		expect(cells_of(figure(9.9999), SCALE, 0)[0]).toBe(' 100')
		expect(cells_of(figure(9.99), SCALE, 0)[0]).toBe('99.9')
	})

	it('draws blanks of the cell’s width for cores not read yet and for a row with no figure', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const [cpu] = cells_of(figure(undefined), SCALE, GAUGE)
		const widths = cell_widths(GAUGE)

		expect(cpu).toBe(' '.repeat(widths[0] ?? 0))
		expect(cells_of(undefined, SCALE, GAUGE)).toStrictEqual(
			widths.map((width) => ' '.repeat(width)),
		)
	})

	it('shades each gauge at the header’s thresholds', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [cpu, memory] = cells_of(figure(9.5, 15), SCALE, GAUGE)

		expect(cpu).toBe(`95.0 ${bar_of(9.5, 10, GAUGE, GAUGE_SHADES.red)}`)
		expect(memory).toBe(`15.0 ${bar_of(15, 20, GAUGE, GAUGE_SHADES.yellow)}`)
	})
})

describe('run_board_usage_text.cell_widths', () => {
	it('counts the figure, the gap and the gauge', () => {
		expect(cell_widths(GAUGE)).toStrictEqual([10, 10, 10])
	})

	it('draws the figure alone at a gauge of 0, the memories in GB with no unit', () => {
		expect(cell_widths(0)).toStrictEqual([4, 4, 4])
		expect(cells_of(figure(1.8), SCALE, 0)).toStrictEqual(['18.0', ' 1.6', ' 0.5'])
		expect(cells_of(figure(undefined), SCALE, 0)[0]).toBe(' '.repeat(4))
	})
})

describe('run_board_usage_text.plain_of', () => {
	it('joins the three figures with their units, and a dash for cores not read yet', () => {
		const eleven: UsageScale = { cores: 11, total_bytes: 20 * GB }

		expect(plain_of(figure(6.2, 2.7, 1.5), eleven)).toBe('56.4%/2.7G/1.5G')
		expect(plain_of(figure(undefined, 0.7, 0.6), eleven)).toBe('-/0.7G/0.6G')
	})
})

// joshuafolkken/kit#3554: a settled row's finish time, dated on another day.
describe('run_board_usage_text.finish_of', () => {
	const NOW = new Date(2026, 9, 9, 16, 30).getTime()

	it('draws a finish time of the board’s own day as `🔚 HH:MM`', () => {
		expect(finish_of(new Date(2026, 9, 9, 14, 5).getTime(), NOW)).toBe('🔚 14:05')
	})

	it('dates a finish time of another day', () => {
		expect(finish_of(new Date(2026, 9, 8, 23, 59).getTime(), NOW)).toBe('🔚 10/8 23:59')
	})

	it('draws nothing for a row settled with no recorded end', () => {
		expect(finish_of(undefined, NOW)).toBeUndefined()
	})
})
