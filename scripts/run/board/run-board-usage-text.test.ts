import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { LaneUsage } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#3489: a running row's `⚡ 20% 🧠1.6G`, green, yellow or red.
// joshuafolkken/kit#3612: the thresholds are the lane's share of the header's yellow threshold among
// the running rows — yellow at three quarters of the share, red at the share itself.

const { GAUGE_SHADES, painted } = run_board_labels
const { finish_of, lane_thresholds, text_of } = run_board_usage_text
const GB = 1024 * 1024 * 1024
const POOL = 70
const BELOW = 0.01

function usage(cpu_percent: number | undefined, memory_percent = 5): LaneUsage {
	return { cpu_percent, memory_bytes: 1.6 * GB, memory_percent }
}

// The memory figure's shade alone, the CPU figure left out.
function memory_text(memory_percent: number, running: number): string | undefined {
	return text_of(usage(undefined, memory_percent), running)
}

function memory_shaded(shade: keyof typeof GAUGE_SHADES): string {
	return `🧠${painted(GAUGE_SHADES[shade], '1.6G')}`
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_usage_text.text_of', () => {
	it('draws the CPU share and the memory in gigabytes', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(text_of(usage(20.4), 1)).toBe('⚡ 20% 🧠1.6G')
	})

	it('draws the memory alone before a CPU share is known, and nothing for a lane with no process', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(text_of(usage(undefined), 1)).toBe('🧠1.6G')
		expect(text_of(undefined, 1)).toBeUndefined()
	})

	it.each([1, 3, 8])(
		'turns at three quarters of the share and at the share among %i lanes',
		(running) => {
			vi.stubEnv('FORCE_COLOR', '1')
			const share = POOL / running
			const yellow = share * 0.75

			expect(memory_text(yellow - BELOW, running)).toBe(memory_shaded('normal'))
			expect(memory_text(yellow, running)).toBe(memory_shaded('yellow'))
			expect(memory_text(share - BELOW, running)).toBe(memory_shaded('yellow'))
			expect(memory_text(share, running)).toBe(memory_shaded('red'))
		},
	)

	it('shades the same usage by how many lanes are running', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		// 2.0 GB of an 18 GB machine: under three lanes' yellow, past eight lanes' share.
		const percent = (2 / 18) * 100

		expect(memory_text(percent, 3)).toBe(memory_shaded('normal'))
		expect(memory_text(percent, 8)).toBe(memory_shaded('red'))
	})
})

describe('run_board_usage_text.text_of — the CPU figure', () => {
	it('shades the CPU figure against the CPU share', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const text = '20%'.padStart(4)

		expect(text_of(usage(20, 0), 3)).toBe(
			`⚡${painted(GAUGE_SHADES.yellow, text)} ${memory_shaded('normal')}`,
		)
	})
})

describe('run_board_usage_text.lane_thresholds', () => {
	it('divides the pool among the running lanes, and reads no lane as one', () => {
		expect(lane_thresholds(POOL, 2)).toStrictEqual({ yellow: 26.25, red: 35 })
		expect(lane_thresholds(POOL, 0)).toStrictEqual(lane_thresholds(POOL, 1))
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
