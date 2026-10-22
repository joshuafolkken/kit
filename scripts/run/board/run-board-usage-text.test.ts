import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { UsageFigure, UsageScale } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#4171: a lane row's and a processes row's CPU, MEM and CMPRS cells — a figure and
// a gauge each, full at the whole machine and shaded at the header's thresholds unless a
// lane row passes its share, which also fills its gauge.

const { GAUGE_SHADES, bar_of } = run_board_labels
const { cell_widths, cells_of, lane_limits, lane_thresholds, plain_of } = run_board_usage_text
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

// joshuafolkken/kit#4283: a lane row's thresholds are its share of the header's yellow threshold.
describe('run_board_usage_text.lane_thresholds', () => {
	it('turns yellow at three quarters of the share and red past the share itself', () => {
		expect(lane_thresholds(70, 1)).toStrictEqual({ yellow: 52.5, red: 70 })
		expect(lane_thresholds(70, 2)).toStrictEqual({ yellow: 26.25, red: 35 })
	})

	it('treats no running lane as one', () => {
		expect(lane_thresholds(70, 0)).toStrictEqual(lane_thresholds(70, 1))
	})

	it('shades a lane row at its share where the machine’s thresholds would leave it green', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [cpu, memory] = cells_of(figure(5.95, 6), SCALE, GAUGE, lane_limits(2))

		expect(cpu).toBe(`59.5 ${bar_of(5.95, 3.5, GAUGE, GAUGE_SHADES.red)}`)
		expect(memory).toBe(` 6.0 ${bar_of(6, 7, GAUGE, GAUGE_SHADES.yellow)}`)
	})

	it('keeps the machine’s thresholds where no limits are passed', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(cells_of(figure(5.95), SCALE, GAUGE)[0]).toBe(
			`59.5 ${bar_of(5.95, 10, GAUGE, GAUGE_SHADES.normal)}`,
		)
	})
})

// joshuafolkken/kit#4546: a lane row's gauge is full at its share, so its length agrees with its color.
const MACHINE: UsageScale = { cores: 11, total_bytes: 18 * GB }
const SIX = lane_limits(6)

function cpu_figure(percent: number): UsageFigure {
	return figure((MACHINE.cores * percent) / 100, 1.7, 1.2)
}

describe('run_board_usage_text.lane_limits', () => {
	it('draws a yellow lane four cells long at 10.1% CPU and 1.7 GB with six lanes running', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(cells_of(cpu_figure(10.1), MACHINE, GAUGE, SIX)).toStrictEqual([
			'10.1 ■■■■─',
			' 1.7 ■■■■─',
			' 1.2 ■■■──',
		])
	})

	it('shades the share’s gauges at the share’s thresholds, unchanged', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [cpu, memory] = cells_of(cpu_figure(10.1), MACHINE, GAUGE, SIX)

		expect(cpu).toBe(`10.1 ${bar_of(4, 5, GAUGE, GAUGE_SHADES.yellow)}`)
		expect(memory).toBe(` 1.7 ${bar_of(4, 5, GAUGE, GAUGE_SHADES.yellow)}`)
	})

	it('stops a value past the share at a full red gauge, and draws a small one empty', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const [over] = cells_of(cpu_figure(21.2), MACHINE, GAUGE, SIX)
		const [under] = cells_of(cpu_figure(0.5), MACHINE, GAUGE, SIX)

		expect(over).toBe(`21.2 ${bar_of(1, 1, GAUGE, GAUGE_SHADES.red)}`)
		expect(under).toBe(` 0.5 ${bar_of(0, 1, GAUGE, GAUGE_SHADES.normal)}`)
	})

	it('keeps a processes row’s gauge full at the whole machine', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(cells_of(cpu_figure(10.1), MACHINE, GAUGE)).toStrictEqual([
			'10.1 ■────',
			' 1.7 ─────',
			' 1.2 ─────',
		])
	})
})

describe('run_board_usage_text.plain_of', () => {
	it('joins the three figures with their units, and a dash for cores not read yet', () => {
		const eleven: UsageScale = { cores: 11, total_bytes: 20 * GB }

		expect(plain_of(figure(6.2, 2.7, 1.5), eleven)).toBe('56.4%/2.7G/1.5G')
		expect(plain_of(figure(undefined, 0.7, 0.6), eleven)).toBe('-/0.7G/0.6G')
	})
})
