import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { LaneUsage } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#3489: a running row's `⚡ 20% 🧠1.6G`, green, yellow from a fifth of the machine
// and red from two fifths.

const { GAUGE_SHADES, painted } = run_board_labels
const { finish_of, text_of } = run_board_usage_text
const GB = 1024 * 1024 * 1024

function usage(cpu_percent: number | undefined, memory_percent = 5): LaneUsage {
	return { cpu_percent, memory_bytes: 1.6 * GB, memory_percent }
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_usage_text.text_of', () => {
	it('draws the CPU share and the memory in gigabytes', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(text_of(usage(20.4))).toBe('⚡ 20% 🧠1.6G')
	})

	it('draws the memory alone before a CPU share is known, and nothing for a lane with no process', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(text_of(usage(undefined))).toBe('🧠1.6G')
		expect(text_of(undefined)).toBeUndefined()
	})

	it.each([
		[19, 'normal'],
		[20, 'yellow'],
		[40, 'red'],
	] as const)('shades a lane at %s%% of the machine %s', (percent, shade) => {
		vi.stubEnv('FORCE_COLOR', '1')
		const text = `${String(percent)}%`.padStart(4)
		const memory = painted(GAUGE_SHADES[shade], '1.6G')

		expect(text_of(usage(percent, percent))).toBe(
			`⚡${painted(GAUGE_SHADES[shade], text)} 🧠${memory}`,
		)
	})
})

// joshuafolkken/kit#3554: a settled row's finish time in the usage column, dated on another day.
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
