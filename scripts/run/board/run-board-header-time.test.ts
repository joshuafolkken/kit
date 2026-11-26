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
			{ ...header_of(undefined, spinner), theme: 'wopr', ...overrides },
			mark,
			THIRD_NOW,
			undefined,
		)[2] ?? ''
	)
}

// joshuafolkken/kit#8917: the third line's `″` stays as it is in every theme — the sweep it once placed
// is gone; the spinner turns only while the run works.
describe('run_board_header_time.time_parts — the third line’s age', () => {
	it('keeps the `″` while a running or setting-up run’s spinner turns', () => {
		for (const mark of ['running', 'setup'] as const) {
			expect(third(SPOT, mark)).not.toContain(TICK)
			expect(third(SPOT, mark)).toContain(SECONDS_MARK)
		}

		expect(third(SPOT, 'running')).toContain(SPOT)
	})

	it('keeps the `″` of a watching or waiting run, its spinner column left blank', () => {
		for (const mark of ['idle', 'human'] as const) {
			expect(third(SPOT, mark)).toContain(SECONDS_MARK)
			expect(third(SPOT, mark)).not.toContain(SPOT)
			expect(third(SPOT, mark)).toMatch(/^ +\d/u)
		}
	})

	it('keeps the `″` of a waiting run while the network is down', () => {
		const outage = { from_ms: NOW_MS - OUTAGE_MS, down_ms: NOW_MS }
		const activity = { last_event_ms: NOW_MS, outage, is_stopped: false }

		expect(third(SPOT, 'idle', { activity })).not.toContain(TICK)
	})

	it('leaves the `″` as it is with no spinner, or for a run that has stopped', () => {
		expect(third(undefined, 'running')).toContain(SECONDS_MARK)
		expect(third(SPOT, 'stopped')).toContain(SECONDS_MARK)
	})

	// joshuafolkken/kit#8478: an ended run draws `—` in the third cell.
	it('draws an ended run’s third cell as `—`', () => {
		expect(third(SPOT, 'idle', { ended_ms: NOW_MS }).trim()).toBe('—')
	})
})

const SECOND = 1000
const HOUR_MS = 60 * MS_PER_MINUTE
const LEFT_MS = 35 * MS_PER_MINUTE
// One sign — or the spinner — then the eight-column span.
const CELL_WIDTH = 9

// The three time cells of a running run started `age_ms` ago, `left_ms` left.
function cells_of(age_ms: number, left_ms: number | undefined): Array<string> {
	const header = { ...header_of(undefined, SPOT), started_ms: NOW_MS - age_ms }

	return time_parts(header, 'running', THIRD_NOW, left_ms)
}

// joshuafolkken/kit#8478: what is left after `-` over the age after `+` over the spinner and the third
// line's age, one fixed width so the column never moves as a time grows.
describe('run_board_header_time.time_parts — the signed column', () => {
	it('draws what is left, the age, then the spinner and the third line’s age', () => {
		const [left, age, now] = cells_of(5 * MS_PER_MINUTE, LEFT_MS)

		expect(left).toBe('-  35′00″')
		expect(age).toBe('+   5′00″')
		expect(now).toBe(`${SPOT}     16″`)
	})

	it('keeps every cell one width, the spinner its own cell, past an hour', () => {
		for (const age_ms of [SECOND, HOUR_MS + SECOND, 2 * HOUR_MS]) {
			const cells = cells_of(age_ms, LEFT_MS)

			expect(cells.map((cell) => cell.length)).toStrictEqual([CELL_WIDTH, CELL_WIDTH, CELL_WIDTH])
			expect(cells[2]?.startsWith(SPOT)).toBe(true)
		}
	})

	it('draws what is left unknown where no finish is estimated', () => {
		expect(cells_of(SECOND, undefined)[0]).toBe('-  --′--″')
	})

	it('draws an ended run with none left, its age stopped at its end, and `—` under them', () => {
		const header = { ...header_of(undefined, SPOT), started_ms: NOW_MS - HOUR_MS, ended_ms: NOW_MS }
		const later = { ...header, now_ms: NOW_MS + HOUR_MS }

		expect(time_parts(later, 'idle', THIRD_NOW, LEFT_MS)).toStrictEqual([
			'-      0″',
			'+1°00′00″',
			'        —',
		])
	})
})

describe('run_board_header_time.time_parts — frames without a sweep', () => {
	it.each([undefined, 'trace'] as const)('leaves the seconds mark in theme %s', (theme) => {
		for (const mark of ['running', 'setup', 'idle', 'human'] as const) {
			expect(third(SPOT, mark, { theme })).not.toContain(TICK)
			expect(third(SPOT, mark, { theme })).toContain(SECONDS_MARK)
		}
	})

	it('leaves the seconds mark in once and chat frames in wopr', () => {
		expect(third(undefined, 'running', { form: 'screen' })).not.toContain(TICK)
		expect(third(undefined, 'running', { form: 'chat' })).not.toContain(TICK)
	})
})
