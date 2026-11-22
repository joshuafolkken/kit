import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_notice_trace, type NoticeTrace } from './run-board-notice-trace'
import { run_board_rain } from './run-board-rain'
import { run_board_row_key } from './run-board-row-key'

// joshuafolkken/kit#8658: the matrix notice trace — spin, lock, a two-blink inverse bar one column past
// each end, then a bright hold — drawn at the demo's times and as wide as the notice at every time.

const { LETTER_MS, is_tracing, length_of, trace_of, traced } = run_board_notice_trace
const { bright: BRIGHT, head: HEAD } = run_board_header_trace.SHADES
const { painted } = run_board_labels
const ESC = '\u{1B}'
const INVERSE = `${ESC}[7m`
// The notice `ab c` with the column before and after it.
const PLAIN = ' ab c '
const PLAIN_LENGTH = 4
const LOCKED_MS = PLAIN_LENGTH * LETTER_MS
const STYLED = ` ${ESC}[32m通知 ab${ESC}[0m 🔊 `
// A character no column wide between two letters.
const ZERO_WIDTH = ' a\u{200B}b '
const STEP_PAST_END_MS = 5000
const NOW_MS = 9000
const KEY = run_board_row_key.key_of('notice', '12:00 lane-end · #1 merged')

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

function zero(): number {
	return 0
}

function head_glyph(): string {
	return painted(HEAD, run_board_rain.fresh(zero))
}

function bright(text: string): string {
	return painted(BRIGHT, text)
}

function bar(text: string): string {
	return styleText('inverse', bright(text))
}

function bar_line(): string {
	return [' ', 'a', 'b', ' ', 'c', ' '].map((letter) => bar(letter)).join('')
}

function bright_line(): string {
	return ` ${bright('a')}${bright('b')}${bright(' ')}${bright('c')} `
}

function drawn_width(text: string): number {
	return run_board_fit.width_of(stripVTControlCharacters(text))
}

function times_of(text: string): Array<number> {
	const end_ms = length_of(text) * LETTER_MS + STEP_PAST_END_MS

	return Array.from({ length: end_ms / LETTER_MS + 1 }, (_, index) => index * LETTER_MS)
}

describe('run_board_notice_trace.traced — the trace', () => {
	it('spins every letter in the head’s color at 0 ms and keeps the blank blank', () => {
		const glyph = head_glyph()

		expect(traced(PLAIN, 0, zero)).toBe(` ${glyph}${glyph}${bright(' ')}${glyph} `)
	})

	it('draws a colored margin as the frame draws it, its color closed after it', () => {
		const dim = `${ESC}[2m`

		expect(traced(`${dim}-${run_board_cut_styled.RESET}a `, 0, zero)).toBe(
			`${dim}-${run_board_cut_styled.RESET}${head_glyph()} `,
		)
	})

	it('leaves a text with no letter between its margins as it is', () => {
		expect(traced('  ', 0, zero)).toBe('  ')
	})

	it('locks the letters left of the step in bright green and spins the rest', () => {
		expect(traced(PLAIN, LETTER_MS * 2, zero)).toBe(
			` ${bright('a')}${bright('b')}${bright(' ')}${head_glyph()} `,
		)
	})

	it('spins glyphs from the rain’s set', () => {
		const letters = stripVTControlCharacters(traced(PLAIN, 0, Math.random))
			.trim()
			.split(' ')

		expect(
			letters
				.join('')
				.split('')
				.every((glyph) => run_board_rain.GLYPHS.includes(glyph)),
		).toBe(true)
	})
})

describe('run_board_notice_trace.traced — the stages after the last letter locks', () => {
	it.each([
		[0, 'bar'],
		[999, 'bar'],
		[1000, 'bright'],
		[1999, 'bright'],
		[2000, 'bar'],
		[2999, 'bar'],
		[3000, 'bright'],
		[3999, 'bright'],
	])('draws %i ms after the lock as the %s', (held_ms, stage) => {
		const expected = stage === 'bar' ? bar_line() : bright_line()

		expect(traced(PLAIN, LOCKED_MS + held_ms, zero)).toBe(expected)
	})

	it('draws the notice as the frame draws it from 4000 ms after the lock', () => {
		expect(traced(STYLED, length_of(STYLED) * LETTER_MS + 4000, zero)).toBe(STYLED)
	})
})

describe('run_board_notice_trace.traced — the bar', () => {
	it('reaches one column past each end of the notice', () => {
		const pieces = run_board_cut_styled.styled_pieces(traced(PLAIN, LOCKED_MS, zero))

		expect(pieces.map((piece) => piece.style.includes(INVERSE))).toStrictEqual(
			Array.from({ length: PLAIN_LENGTH + 2 }, () => true),
		)
	})

	it('is lit twice', () => {
		const lit = times_of(PLAIN).map((at_ms) => traced(PLAIN, at_ms, zero).includes(INVERSE))
		const lightings = lit.filter((is_lit, index) => is_lit && lit[index - 1] !== true)

		expect(lightings).toHaveLength(2)
	})
})

describe('run_board_notice_trace.traced — the width', () => {
	it.each([PLAIN, STYLED, ZERO_WIDTH])('keeps %j as wide at every time', (text) => {
		const widths = times_of(text).map((at_ms) => drawn_width(traced(text, at_ms, Math.random)))

		expect(new Set(widths)).toStrictEqual(new Set([drawn_width(text)]))
	})
})

describe('run_board_notice_trace — the demo’s times', () => {
	it('steps a letter per 50 ms, blinks a second on and off, and holds 4000 ms after the lock', () => {
		const { TRACE_BLINK_MS, TRACE_BRIGHT_MS, TRACE_GAP_MS } = run_board_notice_trace

		expect([LETTER_MS, TRACE_BLINK_MS, TRACE_GAP_MS, TRACE_BRIGHT_MS]).toStrictEqual([
			50, 1000, 1000, 4000,
		])
	})
})

describe('run_board_notice_trace.is_tracing', () => {
	it('holds until 4000 ms after the last letter locks', () => {
		expect(is_tracing(LOCKED_MS + 3999, PLAIN_LENGTH)).toBe(true)
		expect(is_tracing(LOCKED_MS + 4000, PLAIN_LENGTH)).toBe(false)
	})

	it('counts the notice’s letters without its margins', () => {
		expect(length_of(PLAIN)).toBe(PLAIN_LENGTH)
	})
})

// joshuafolkken/kit#8657: the spin wakes when the trace next changes its look.
describe('run_board_notice_trace.change_after', () => {
	it.each([
		[0, LETTER_MS],
		[LETTER_MS + 1, LETTER_MS * 2],
		[LOCKED_MS - 1, LOCKED_MS],
		[LOCKED_MS, LOCKED_MS + 1000],
		[LOCKED_MS + 999, LOCKED_MS + 1000],
		[LOCKED_MS + 1000, LOCKED_MS + 2000],
		[LOCKED_MS + 2000, LOCKED_MS + 3000],
		[LOCKED_MS + 3000, LOCKED_MS + 4000],
		[LOCKED_MS + 4000, Infinity],
	])('changes after %d ms at %d ms', (since_ms, next_ms) => {
		expect(run_board_notice_trace.change_after(since_ms, PLAIN_LENGTH)).toBe(next_ms)
	})
})

describe('run_board_notice_trace.trace_of — when a trace starts', () => {
	const notice = { key: KEY, is_standing: false }
	const running: NoticeTrace = { key: KEY, start_ms: 0 }

	it('starts now on a new notice', () => {
		expect(trace_of(notice, undefined, NOW_MS)).toStrictEqual({ key: KEY, start_ms: NOW_MS })
	})

	it('starts over on the next notice while one is tracing', () => {
		const next = { key: `${KEY} ×2`, is_standing: false }

		expect(trace_of(next, running, NOW_MS)).toStrictEqual({ key: next.key, start_ms: NOW_MS })
	})

	it('carries the trace while the key holds, as when the notice turns faint or the sound switches', () => {
		expect(trace_of(notice, running, NOW_MS)).toBe(running)
	})

	it.each([
		['the empty slot', { key: run_board_row_key.key_of('notice', '—'), is_standing: false }],
		[
			'a standing state',
			{ key: run_board_row_key.key_of('notice', '⚠ stale m'), is_standing: true },
		],
		['a slot with no key', { key: undefined, is_standing: false }],
	])('does not start on %s', (_, slot) => {
		expect(trace_of(slot, undefined, NOW_MS)).toBeUndefined()
	})
})
