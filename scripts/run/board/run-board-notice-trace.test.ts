import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_fit } from './run-board-fit'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels, type Paint } from './run-board-labels'
import { run_board_notice_trace, type NoticeLook, type NoticeTrace } from './run-board-notice-trace'
import { run_board_rain } from './run-board-rain'
import { run_board_row_key } from './run-board-row-key'
import { run_board_theme_defs, type Theme } from './run-board-theme-defs'

// joshuafolkken/kit#8658, joshuafolkken/kit#8745: the notice trace — the matrix rain's spin and lock or a
// typed arrival, then an inverse bar one column past each end three times, then the lit hold — drawn at
// the demo's times, in each theme's lit color, and as wide as the notice at every time.

const { LETTER_MS, is_drawn, length_of, trace_of, traced } = run_board_notice_trace
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
const STEP_PAST_END_MS = 9000
const NOW_MS = 9000
const BLINKS = 3
const KEY = run_board_row_key.key_of('notice', '12:00 lane-end · #1 merged')

function look_of(theme: Theme): NoticeLook {
	const look = run_board_theme_defs.live_of(theme).notice

	if (look === undefined) throw new Error(`no notice look in ${theme}`)

	return look
}

const MATRIX = look_of('matrix')
const WARGAMES = look_of('wargames')

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

function lit(text: string, paint: Paint = BRIGHT): string {
	return painted(paint, text)
}

function bar(text: string, paint: Paint = BRIGHT): string {
	return styleText('inverse', lit(text, paint))
}

function bar_line(paint: Paint = BRIGHT): string {
	return [' ', 'a', 'b', ' ', 'c', ' '].map((letter) => bar(letter, paint)).join('')
}

function lit_line(paint: Paint = BRIGHT): string {
	return ` ${lit('a', paint)}${lit('b', paint)}${lit(' ', paint)}${lit('c', paint)} `
}

function drawn_width(text: string): number {
	return run_board_fit.width_of(stripVTControlCharacters(text))
}

function times_of(text: string): Array<number> {
	const end_ms = length_of(text) * LETTER_MS + STEP_PAST_END_MS

	return Array.from({ length: end_ms / LETTER_MS + 1 }, (_, index) => index * LETTER_MS)
}

describe('run_board_notice_trace.traced — the rain', () => {
	it('spins every letter in the head’s color at 0 ms and keeps the blank blank', () => {
		const glyph = head_glyph()

		expect(traced(PLAIN, 0, MATRIX, zero)).toBe(` ${glyph}${glyph}${lit(' ')}${glyph} `)
	})

	it('draws a colored margin as the frame draws it, its color closed after it', () => {
		const dim = `${ESC}[2m`

		expect(traced(`${dim}-${run_board_cut_styled.RESET}a `, 0, MATRIX, zero)).toBe(
			`${dim}-${run_board_cut_styled.RESET}${head_glyph()} `,
		)
	})

	it('leaves a text with no letter between its margins as it is', () => {
		expect(traced('  ', 0, MATRIX, zero)).toBe('  ')
	})

	it('locks the letters left of the step in bright green and spins the rest', () => {
		expect(traced(PLAIN, LETTER_MS * 2, MATRIX, zero)).toBe(
			` ${lit('a')}${lit('b')}${lit(' ')}${head_glyph()} `,
		)
	})

	it('leaves a typed look’s notice to the theme while its letters type', () => {
		expect(traced(PLAIN, LOCKED_MS - 1, WARGAMES, zero)).toBe(PLAIN)
	})

	it('spins glyphs from the rain’s set', () => {
		const letters = stripVTControlCharacters(traced(PLAIN, 0, MATRIX, Math.random))
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

describe('run_board_notice_trace.traced — the stages after the last letter lands', () => {
	it.each([
		[0, 'bar'],
		[999, 'bar'],
		[1000, 'lit'],
		[1999, 'lit'],
		[2000, 'bar'],
		[2999, 'bar'],
		[3000, 'lit'],
		[3999, 'lit'],
		[4000, 'bar'],
		[4999, 'bar'],
		[5000, 'lit'],
		[6000, 'lit'],
		[600_000, 'lit'],
	])('draws %i ms after the lock as the %s', (held_ms, stage) => {
		const expected = stage === 'bar' ? bar_line() : lit_line()

		expect(traced(PLAIN, LOCKED_MS + held_ms, MATRIX, zero)).toBe(expected)
	})

	it('counts a typed look’s stages from its last letter', () => {
		expect(traced(PLAIN, LOCKED_MS, WARGAMES, zero)).toBe(bar_line(WARGAMES.lit))
	})
})

describe('run_board_notice_trace.traced — each theme’s lit color', () => {
	it.each([
		['matrix', '0;255;65'],
		['wargames', '62;236;225'],
		['bttf', '190;198;206'],
	] as const)('bars and holds the %s notice in %s', (theme, rgb) => {
		const look = look_of(theme)
		const held_ms = LOCKED_MS + BLINKS * run_board_notice_trace.PAIR_MS

		expect(look.lit).toMatchObject({ rgb })
		expect(traced(PLAIN, LOCKED_MS, look, zero)).toBe(bar_line(look.lit))
		expect(traced(PLAIN, held_ms, look, zero)).toBe(lit_line(look.lit))
	})
})

describe('run_board_notice_trace.traced — the bar', () => {
	it('reaches one column past each end of the notice', () => {
		const pieces = run_board_cut_styled.styled_pieces(traced(PLAIN, LOCKED_MS, MATRIX, zero))

		expect(pieces.map((piece) => piece.style.includes(INVERSE))).toStrictEqual(
			Array.from({ length: PLAIN_LENGTH + 2 }, () => true),
		)
	})

	it('leaves the margins as the frame draws them while lit', () => {
		expect(traced(PLAIN, LOCKED_MS + 1000, MATRIX, zero).startsWith(' ')).toBe(true)
	})

	it.each([MATRIX, WARGAMES])('is lit three times', (look) => {
		const barred = times_of(PLAIN).map((at_ms) =>
			traced(PLAIN, at_ms, look, zero).includes(INVERSE),
		)
		const lightings = barred.filter((is_lit, index) => is_lit && barred[index - 1] !== true)

		expect(lightings).toHaveLength(BLINKS)
	})
})

describe('run_board_notice_trace.traced — the width', () => {
	it.each([PLAIN, STYLED, ZERO_WIDTH])('keeps %j as wide at every time', (text) => {
		const widths = times_of(text).map((at_ms) =>
			drawn_width(traced(text, at_ms, MATRIX, Math.random)),
		)

		expect(new Set(widths)).toStrictEqual(new Set([drawn_width(text)]))
	})
})

describe('run_board_notice_trace — the demo’s times', () => {
	it('steps a letter per 50 ms and blinks a second on and off', () => {
		const { TRACE_BLINK_MS, TRACE_GAP_MS } = run_board_notice_trace

		expect([LETTER_MS, TRACE_BLINK_MS, TRACE_GAP_MS]).toStrictEqual([50, 1000, 1000])
	})
})

describe('run_board_notice_trace.is_drawn', () => {
	it('draws a rain look from the start', () => {
		expect(is_drawn(0, PLAIN_LENGTH, MATRIX)).toBe(true)
	})

	it('draws a typed look once its letters have typed', () => {
		expect(is_drawn(LOCKED_MS - 1, PLAIN_LENGTH, WARGAMES)).toBe(false)
		expect(is_drawn(LOCKED_MS, PLAIN_LENGTH, WARGAMES)).toBe(true)
	})

	it('counts the notice’s letters without its margins', () => {
		expect(length_of(PLAIN)).toBe(PLAIN_LENGTH)
	})
})

// joshuafolkken/kit#8657: the spin wakes when the trace next changes its look, and never once it holds.
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
		[LOCKED_MS + 4000, LOCKED_MS + 5000],
		[LOCKED_MS + 5000, Infinity],
		[LOCKED_MS + 6000, Infinity],
	])('changes after %d ms at %d ms', (since_ms, next_ms) => {
		expect(run_board_notice_trace.change_after(since_ms, PLAIN_LENGTH, MATRIX)).toBe(next_ms)
	})

	it('wakes a typed look once, when its letters have typed', () => {
		expect(run_board_notice_trace.change_after(0, PLAIN_LENGTH, WARGAMES)).toBe(LOCKED_MS)
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
