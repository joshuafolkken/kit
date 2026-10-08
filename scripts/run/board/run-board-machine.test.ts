import { stripVTControlCharacters, styleText } from 'node:util'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_machine, type MachineMark } from './run-board-machine'

// joshuafolkken/kit#3450: the machine line — CPU and swap from the difference between two samples,
// memory pressure from one, a bar that stops full, yellow and red past a threshold, and nothing drawn
// for a figure that could not be read.

const { gauges_of, line_of } = run_board_machine
const SECOND = 1000
const UNREAD = { cpu_percent: undefined, memory_percent: undefined, swap_mb_per_s: undefined }

function sample(busy: number, total: number, swapped_mb: number | undefined): MachineSample {
	return { cpu: { busy, total }, memory: { available_mb: 630, swapped_mb }, total_mb: 1000 }
}

function mark(at_ms: number, machine: MachineSample): MachineMark {
	return { sample: machine, at_ms }
}

function plain(gauges: Parameters<typeof line_of>[0]): string | undefined {
	const line = line_of(gauges)

	return line === undefined ? undefined : stripVTControlCharacters(line)
}

// The swap rate a second after a sample that had swapped 50 MB.
function swap_after(swapped_mb: number | undefined): number | undefined {
	const before = mark(0, sample(0, 1000, 50))

	return gauges_of(before, mark(SECOND, sample(0, 2000, swapped_mb))).swap_mb_per_s
}

function swap_line(rate: number): string {
	return line_of({ ...UNREAD, swap_mb_per_s: rate }) ?? ''
}

describe('run_board_machine.gauges_of', () => {
	it('draws CPU and swap from the difference over the time that passed', () => {
		const before = mark(0, sample(100, 1000, 10))
		const after = mark(2 * SECOND, sample(250, 2000, 16))

		expect(gauges_of(before, after)).toStrictEqual({
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3,
		})
	})

	it('leaves CPU and swap out of the first sample, which has nothing to differ from', () => {
		const gauges = gauges_of(undefined, mark(0, sample(0, 0, 0)))

		expect(gauges).toStrictEqual({
			cpu_percent: undefined,
			memory_percent: 37,
			swap_mb_per_s: undefined,
		})
	})

	it('reads a swap counter that went back as nothing swapped, and an unread one as unread', () => {
		expect(swap_after(10)).toBe(0)
		expect(swap_after(undefined)).toBeUndefined()
	})
})

describe('run_board_machine.line_of', () => {
	it('draws the three gauges with right-aligned figures', () => {
		const gauges = { cpu_percent: 15, memory_percent: 37, swap_mb_per_s: 3.1 }

		expect(plain(gauges)).toBe('🔥 ━━░░░░░░░░  15%   🧠 ━━━━░░░░░░  37%   💾 ━━░░░░░░░░ 3.1M/s')
	})

	it('stops the bar full past the gauge’s end, keeping the figure the same width', () => {
		const gauges = { cpu_percent: 100, memory_percent: undefined, swap_mb_per_s: 42 }

		expect(plain(gauges)).toBe(`🔥 ${'━'.repeat(10)} 100%   💾 ${'━'.repeat(10)}  42M/s`)
	})

	it('leaves out an unread gauge, and the whole line when none was read', () => {
		expect(plain({ ...UNREAD, memory_percent: 37 })).toBe('🧠 ━━━━░░░░░░  37%')
		expect(line_of(UNREAD)).toBeUndefined()
		expect(line_of(undefined)).toBeUndefined()
	})
})

describe('run_board_machine.line_of colors', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('colors swap yellow from 1 MB/s and red from 10 MB/s', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(swap_line(0.5)).toBe('💾 ░░░░░░░░░░ 0.5M/s')
		expect(swap_line(3)).toBe(`💾 ${styleText('yellow', '━━░░░░░░░░ 3.0M/s')}`)
		expect(swap_line(12)).toBe(`💾 ${styleText('red', '━━━━━━░░░░  12M/s')}`)
	})

	it('colors CPU and memory past their thresholds', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(line_of({ ...UNREAD, cpu_percent: 95 })).toContain(styleText('red', '━━━━━━━━━━  95%'))
		expect(line_of({ ...UNREAD, memory_percent: 75 })).toContain(
			styleText('yellow', '━━━━━━━━░░  75%'),
		)
	})
})
