import { stripVTControlCharacters, styleText } from 'node:util'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TextColor } from './run-board-labels'
import { run_board_machine, type MachineMark } from './run-board-machine'

// joshuafolkken/kit#3450: the machine line — CPU and swap from the difference between two samples,
// memory pressure from one, a bar that stops full, yellow and red past a threshold, and nothing drawn
// for a figure that could not be read. joshuafolkken/kit#3452: icon, figure, then bar; CPU and memory
// green when normal, memory colored by the kernel's pressure verdict where one was read.

const { gauges_of, line_of } = run_board_machine
const SECOND = 1000
const BAR_WIDTH = 10
const WARNING = 2
const GREEN_RGB = '48;209;88'
const YELLOW_RGB = '255;214;10'
const RED_RGB = '255;69;58'
const UNREAD = {
	cpu_percent: undefined,
	memory_percent: undefined,
	swap_mb_per_s: undefined,
	memory_pressure: undefined,
}

function sample(busy: number, total: number, swapped_mb: number | undefined): MachineSample {
	const memory = { available_mb: 630, swapped_mb, pressure_level: WARNING }

	return { cpu: { busy, total }, memory, total_mb: 1000 }
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

function memory_line(percent: number, pressure: number | undefined): string {
	return line_of({ ...UNREAD, memory_percent: percent, memory_pressure: pressure }) ?? ''
}

// A colored bar as the board draws it: `filled` cells in `color`, the rest dimmed.
function bar(filled: number, color: TextColor): string {
	const done = filled === 0 ? '' : styleText(color, '■'.repeat(filled))
	const left = filled === BAR_WIDTH ? '' : styleText('dim', '─'.repeat(BAR_WIDTH - filled))

	return done + left
}

// Text in a 24-bit color, as the `38;2;R;G;B` escape draws it.
function rgb(code: string, text: string): string {
	return `\u{1B}[38;2;${code}m${text}\u{1B}[39m`
}

// A bar whose `filled` cells are in a 24-bit color, the rest dimmed.
function rgb_bar(filled: number, code: string): string {
	return rgb(code, '■'.repeat(filled)) + styleText('dim', '─'.repeat(BAR_WIDTH - filled))
}

describe('run_board_machine.gauges_of', () => {
	it('draws CPU and swap from the difference over the time that passed', () => {
		const before = mark(0, sample(100, 1000, 10))
		const after = mark(2 * SECOND, sample(250, 2000, 16))

		expect(gauges_of(before, after)).toStrictEqual({
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3,
			memory_pressure: WARNING,
		})
	})

	it('leaves CPU and swap out of the first sample, which has nothing to differ from', () => {
		const gauges = gauges_of(undefined, mark(0, sample(0, 0, 0)))

		expect(gauges).toStrictEqual({
			cpu_percent: undefined,
			memory_percent: 37,
			swap_mb_per_s: undefined,
			memory_pressure: WARNING,
		})
	})

	it('reads a swap counter that went back as nothing swapped, and an unread one as unread', () => {
		expect(swap_after(10)).toBe(0)
		expect(swap_after(undefined)).toBeUndefined()
	})
})

describe('run_board_machine.line_of', () => {
	// joshuafolkken/kit#3508: two spaces between the gauges, as between the header's parts.
	it('draws each gauge as icon, right-aligned figure, then bar, two spaces apart', () => {
		const gauges = { ...UNREAD, cpu_percent: 15, memory_percent: 37, swap_mb_per_s: 3.1 }

		expect(plain(gauges)).toBe('⚡  15% ■■────────  🧠  37% ■■■■──────  💾 3.1M/s ■■────────')
	})

	it('stops the bar full past the gauge’s end, keeping the figure the same width', () => {
		const gauges = { ...UNREAD, cpu_percent: 100, swap_mb_per_s: 42 }

		expect(plain(gauges)).toBe(`⚡ 100% ${'■'.repeat(10)}  💾  42M/s ${'■'.repeat(10)}`)
	})

	it('leaves out an unread gauge, and the whole line when none was read', () => {
		expect(plain({ ...UNREAD, memory_percent: 37 })).toBe('🧠  37% ■■■■──────')
		expect(plain({ ...UNREAD, swap_mb_per_s: 0 })).toBe(`💾 0.0M/s ${'─'.repeat(10)}`)
		expect(line_of(UNREAD)).toBeUndefined()
		expect(line_of(undefined)).toBeUndefined()
	})
})

describe('run_board_machine.line_of colors', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('colors swap yellow from 1 MB/s and red from 10 MB/s, and leaves a quiet swap uncolored', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(swap_line(0.5)).toBe(`💾 0.5M/s ${styleText('dim', '─'.repeat(10))}`)
		expect(swap_line(3)).toBe(`💾 ${styleText('yellow', '3.0M/s')} ${bar(2, 'yellow')}`)
		expect(swap_line(12)).toBe(`💾 ${styleText('red', ' 12M/s')} ${bar(6, 'red')}`)
	})

	it('draws a quiet CPU green and colors it yellow and red past its thresholds', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(line_of({ ...UNREAD, cpu_percent: 30 })).toBe(`⚡  30% ${bar(3, 'green')}`)
		expect(line_of({ ...UNREAD, cpu_percent: 75 })).toBe(
			`⚡ ${styleText('yellow', ' 75%')} ${bar(8, 'yellow')}`,
		)
		expect(line_of({ ...UNREAD, cpu_percent: 95 })).toBe(
			`⚡ ${styleText('red', ' 95%')} ${bar(10, 'red')}`,
		)
	})

	it('colors memory by the kernel pressure verdict 1 / 2 / 4 whatever its share', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(memory_line(90, 1)).toBe(`🧠  90% ${bar(9, 'green')}`)
		expect(memory_line(50, 2)).toBe(`🧠 ${styleText('yellow', ' 50%')} ${bar(5, 'yellow')}`)
		expect(memory_line(50, 4)).toBe(`🧠 ${styleText('red', ' 50%')} ${bar(5, 'red')}`)
	})

	it('falls back to the memory thresholds where no known verdict was read', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(memory_line(30, undefined)).toBe(`🧠  30% ${bar(3, 'green')}`)
		expect(memory_line(75, undefined)).toBe(`🧠 ${styleText('yellow', ' 75%')} ${bar(8, 'yellow')}`)
		expect(memory_line(90, 3)).toBe(`🧠 ${styleText('red', ' 90%')} ${bar(9, 'red')}`)
	})
})

// joshuafolkken/kit#3464: in 24-bit color, so no terminal palette draws green blue or red orange.
describe('run_board_machine.line_of in 24-bit color', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('draws the CPU gauge in its 24-bit green, yellow and red where the output has them', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(line_of({ ...UNREAD, cpu_percent: 30 })).toBe(`⚡  30% ${rgb_bar(3, GREEN_RGB)}`)
		expect(line_of({ ...UNREAD, cpu_percent: 75 })).toBe(
			`⚡ ${rgb(YELLOW_RGB, ' 75%')} ${rgb_bar(8, YELLOW_RGB)}`,
		)
		expect(line_of({ ...UNREAD, cpu_percent: 95 })).toBe(
			`⚡ ${rgb(RED_RGB, ' 95%')} ${rgb(RED_RGB, '■'.repeat(BAR_WIDTH))}`,
		)
	})
})
