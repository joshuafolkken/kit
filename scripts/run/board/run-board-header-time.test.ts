import { styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { describe, expect, it } from 'vitest'
import type { RunMark } from './run-board-header-names'
import { run_board_header_time } from './run-board-header-time'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot } from './run-board-spot'

const { aged, now_text, time_parts } = run_board_header_time
const { SECONDS_MARK, SPOT, TICK } = run_board_spot
const PART = '💓 0:16:00'
const STALE_MINUTES = 15
const ALARM_MINUTES = 30
const NOW_MS = Date.parse('2026-11-19T09:00:00.000Z')

describe('run_board_header_time.aged', () => {
	it('leaves a part plain up to fifteen minutes old', () => {
		expect(aged(PART, STALE_MINUTES * MS_PER_MINUTE)).toBe(PART)
	})

	it('draws a part past fifteen minutes old in yellow', () => {
		expect(aged(PART, STALE_MINUTES * MS_PER_MINUTE + 1)).toBe(styleText('yellow', PART))
		expect(aged(PART, ALARM_MINUTES * MS_PER_MINUTE)).toBe(styleText('yellow', PART))
	})

	it('draws a part past thirty minutes old in red', () => {
		expect(aged(PART, ALARM_MINUTES * MS_PER_MINUTE + 1)).toBe(styleText('red', PART))
	})
})

// joshuafolkken/kit#8103: where the board types rows, the third line's words carry their own key after
// the icon, so they type when they change and not when the time alone does.
function header_of(is_keyed?: boolean, spinner?: string): Parameters<typeof now_text>[1] {
	const activity = { last_event_ms: NOW_MS, outage: undefined, is_stopped: false }

	return {
		now_ms: NOW_MS,
		started_ms: NOW_MS,
		ended_ms: undefined,
		activity,
		spinner,
		form: 'screen',
		is_keyed,
	}
}

describe('run_board_header_time.now_text', () => {
	const NOW = { icon: '>', age_ms: 5000, text: '#8093 · WRITE' }

	it('keys the words, not the icon, where the board types rows', () => {
		const split = run_board_row_key.split_key(now_text(NOW, header_of(true)))

		expect(split.key).toBe(`now:${NOW.text}`)
		expect(split.prefix).toBe('> ')
		expect(split.text).toBe(now_text(NOW, header_of()))
	})

	it('draws the words as before, with no key, where the board types no rows', () => {
		expect(now_text(NOW, header_of())).toBe(`> ${NOW.text}`)
		expect(now_text(NOW, header_of(false))).toBe(now_text(NOW, header_of()))
	})
})

const THIRD_NOW = { icon: '>', age_ms: 16_000, text: 'WRITE' }
const OUTAGE_MS = 60_000

// The header's third line, drawn with `spinner` for a run at `mark`.
function third(
	spinner: string | undefined,
	mark: RunMark,
	overrides: Partial<Parameters<typeof time_parts>[0]> = {},
): string {
	return (
		time_parts(
			{ ...header_of(undefined, spinner), theme: 'wargames', ...overrides },
			mark,
			THIRD_NOW,
		)[2] ?? ''
	)
}

// joshuafolkken/kit#8240, #8404: the third line's `″` is drawn as the sweep's placeholder on a terminal
// in wargames for a run neither stopped nor ended; the spinner turns only while the run works.
describe('run_board_header_time.time_parts — the sweep’s placeholder', () => {
	it('marks the `″` with the placeholder while a running or setting-up run’s spinner turns', () => {
		expect(third(SPOT, 'running')).toContain(TICK)
		expect(third(SPOT, 'setup')).toContain(TICK)
		expect(third(SPOT, 'running')).toContain(SPOT)
		expect(third(SPOT, 'running')).not.toContain(SECONDS_MARK)
	})

	it('marks the `″` of a watching or waiting run, its spinner column left blank', () => {
		for (const mark of ['idle', 'human'] as const) {
			expect(third(SPOT, mark)).toContain(TICK)
			expect(third(SPOT, mark)).not.toContain(SPOT)
			expect(third(SPOT, mark)).toMatch(/^ +\d/u)
		}
	})

	it('marks the `″` of a waiting run while the network is down', () => {
		const outage = { from_ms: NOW_MS - OUTAGE_MS, down_ms: NOW_MS }
		const activity = { last_event_ms: NOW_MS, outage, is_stopped: false }

		expect(third(SPOT, 'idle', { activity })).toContain(TICK)
	})

	it('leaves the `″` as it is with no spinner, or for a run that has stopped or ended', () => {
		expect(third(undefined, 'running')).not.toContain(TICK)
		expect(third(undefined, 'idle')).not.toContain(TICK)
		expect(third(undefined, 'running')).toContain(SECONDS_MARK)
		expect(third(SPOT, 'stopped')).not.toContain(TICK)
		expect(third(SPOT, 'idle', { ended_ms: NOW_MS })).not.toContain(TICK)
		expect(third(SPOT, 'idle', { ended_ms: NOW_MS })).toContain(SECONDS_MARK)
	})
})

describe('run_board_header_time.time_parts — frames without a sweep', () => {
	it.each([undefined, 'matrix'] as const)('leaves the seconds mark in theme %s', (theme) => {
		for (const mark of ['running', 'setup', 'idle', 'human'] as const) {
			expect(third(SPOT, mark, { theme })).not.toContain(TICK)
			expect(third(SPOT, mark, { theme })).toContain(SECONDS_MARK)
		}
	})

	it('leaves the seconds mark in once and chat frames in wargames', () => {
		expect(third(undefined, 'running', { form: 'screen' })).not.toContain(TICK)
		expect(third(undefined, 'running', { form: 'chat' })).not.toContain(TICK)
	})
})
