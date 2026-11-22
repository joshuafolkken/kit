import { describe, expect, it } from 'vitest'
import { run_board_theme_defs } from './run-board-theme-defs'
import {
	run_board_type_rows,
	type KeyedLine,
	type Typing,
	type TypingFrame,
} from './run-board-type-rows'

// joshuafolkken/kit#8697: where a theme's trill sounds over the header alone, only the header's notice
// and now rows are heard typing; the rest type silently.

const { HEADER_KEYS, NO_TYPING, is_typing, left_ms, next, typing_of_trill } = run_board_type_rows
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const START = Date.parse('2026-11-19T09:00:00.000Z')
const SECOND = 1000
const NOW = START + SECOND
const ROW = 'x'.repeat(100)
const NOW_PREFIX = 'KIT  ─  5″  > '
const WORDS = '#8093 · WRITE'

function line_of(key: string, index: number, text = ROW, prefix_columns = 0): KeyedLine {
	return { key, index, row: index + 1, text, prefix_columns }
}

const NOW_ROW = line_of(`now:${WORDS}`, 2, `${NOW_PREFIX}${WORDS}`, NOW_PREFIX.length)
const NOTICE_ROW = line_of('notice:merged', 1)
const BODY_ROW = line_of('lanes:#8001', 4)

function frame_of(keyed: ReadonlyArray<KeyedLine>): TypingFrame {
	return { keyed, known: new Set(keyed.map((line) => line.key)) }
}

// The typing from `seed` after an empty base frame, then a frame of `drawn`.
function after_base(seed: Typing, drawn: ReadonlyArray<KeyedLine>): Typing {
	return next(next(seed, frame_of([]), START, true), frame_of(drawn), NOW, true)
}

describe('run_board_type_rows.typing_of_trill', () => {
	it('hears only the header rows where the trill sounds over the header', () => {
		expect(typing_of_trill('header')).toStrictEqual({ ...NO_TYPING, heard: HEADER_KEYS })
	})

	it('hears every row where the trill sounds over all of them', () => {
		expect(typing_of_trill(true)).toBe(NO_TYPING)
	})
})

describe('run_board_type_rows heard rows', () => {
	it('is typing while a now row types among body rows, left only by the now row', () => {
		const typing = after_base(typing_of_trill('header'), [NOW_ROW, BODY_ROW])

		expect(is_typing(typing, NOW)).toBe(true)
		expect(left_ms(typing, NOW)).toBe((WORDS.length - 1) * LETTER_MS)
	})

	it('is typing while a notice row types', () => {
		const typing = after_base(typing_of_trill('header'), [NOTICE_ROW])

		expect(is_typing(typing, NOW)).toBe(true)
	})

	it('is not typing while only body rows type', () => {
		const typing = after_base(typing_of_trill('header'), [BODY_ROW])

		expect(is_typing(typing, NOW)).toBe(false)
		expect(left_ms(typing, NOW)).toBe(0)
	})

	it('hears body rows where every row is heard', () => {
		const typing = after_base(typing_of_trill(true), [BODY_ROW])

		expect(is_typing(typing, NOW)).toBe(true)
	})

	it('keeps the heard rows across frames, typing off included', () => {
		const off = next(typing_of_trill('header'), frame_of([BODY_ROW]), START, false)

		expect(off.heard).toStrictEqual(HEADER_KEYS)
		expect(after_base(off, [BODY_ROW]).heard).toStrictEqual(HEADER_KEYS)
	})
})
