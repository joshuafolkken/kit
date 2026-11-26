import { describe, expect, it } from 'vitest'
import { run_board_theme_codec_alert, type Phase } from './run-board-theme-codec-alert'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { ThemeTimeline } from './run-board-theme-host-types'

// joshuafolkken/kit#8917: the METAL GEAR theme's alert phases.

const { counter_of, lead_end, phase_of, wave_share } = run_board_theme_codec_alert
const { HOST } = run_board_theme_host_fixture
const { row_of } = run_board_theme_host_grid
const { NOTICE_END, state_of } = run_board_theme_host_state

const NOTICE: ThemeTimeline = {
	notice: [{ start: 0, text: 'NOTICE' }],
	progress: [],
	row: [],
}

function phase_at(tick: number): Phase | undefined {
	return phase_of(state_of(HOST.layout, NOTICE, tick), tick)
}

// The first tick the notice has typed through.
function typed_at(): number {
	const ticks = Array.from({ length: 200 }, (_, tick) => tick)

	return ticks.find((tick) => !state_of(HOST.layout, NOTICE, tick).notice.is_typing) ?? 0
}

describe('run_board_theme_codec_alert.phase_of', () => {
	it('is ALERT while the notice types and a second after, then EVASION, CAUTION, and over', () => {
		const typed = typed_at()

		expect(typed).toBeGreaterThan(0)
		expect(phase_at(0)?.label).toBe('ALERT')
		expect(phase_at(typed + 19)?.label).toBe('ALERT')
		expect(phase_at(typed + 20)?.label).toBe('EVASION')
		expect(phase_at(typed + 60)?.label).toBe('CAUTION')
		expect(phase_at(typed + NOTICE_END)).toBeUndefined()
	})

	it('has no phase before a notice', () => {
		expect(
			phase_of(state_of(HOST.layout, { notice: [], progress: [], row: [] }, 5), 5),
		).toBeUndefined()
	})
})

describe('run_board_theme_codec_alert.counter_of', () => {
	it('counts down from 99.99 and stops at 00.00', () => {
		const now: Phase = { label: 'ALERT', color: '', dim: ['', ''], count: 10, rate: 0.05, left: 1 }

		expect(counter_of(now)).toBe('99.49')
		expect(counter_of({ ...now, count: 1_000_000 })).toBe('00.00')
	})
})

describe('run_board_theme_codec_alert wave', () => {
	it('steps the wave in quarters', () => {
		const now: Phase = { label: 'EVASION', color: '', dim: ['', ''], count: 0, rate: 0, left: 0 }

		for (let x = 0; x < 10; x++) expect([0, 0.25, 0.5, 0.75, 1]).toContain(wave_share(now, x, 3, 7))
	})

	it('finds a row’s first word from the indent, none on a blank indent', () => {
		expect(lead_end(row_of('     BD  later', 'body', 14))).toBe(7)
		expect(lead_end(row_of('       later', 'body', 12))).toBe(5)
		expect(lead_end(row_of('──────────', 'rule', 10))).toBe(5)
	})
})
