import { stripVTControlCharacters } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_header_trace } from './run-board-header-trace'
import { run_board_labels } from './run-board-labels'
import { run_board_theme_defs } from './run-board-theme-defs'
import { run_board_type_glow } from './run-board-type-glow'
import { run_board_type_rows, type KeyedLine, type TypingFrame } from './run-board-type-rows'
import { run_board_typing } from './run-board-typing'

// joshuafolkken/kit#8370: where the rows decode, the header's now line types and glows above the rain.

const { GLOW_MS, glowed, glows } = run_board_type_glow
const { NO_TYPING, next, type_bytes, typed_lines } = run_board_type_rows
const { SHADES } = run_board_header_trace
const { painted } = run_board_labels
const { CURSOR } = run_board_typing
const LETTER_MS = run_board_theme_defs.THEME_DEFS.wargames.intro.letter_ms
const START = Date.parse('2026-11-22T09:00:00.000Z')
const SECOND = 1000
const PREFIX = 'KIT > '
const TEXT = `${PREFIX}ABCDE`
const WHITE = '225;255;225'
const BRIGHT = '0;255;65'
const NOW: KeyedLine = { key: 'now:ABCDE', index: 0, row: 1, text: TEXT, prefix_columns: 6 }
const ROW: KeyedLine = { key: 'done:7', index: 1, row: 2, text: 'x'.repeat(20), prefix_columns: 0 }
// The moment the now line types through, started on the frame after the base.
const TYPED_MS = START + SECOND + 4 * LETTER_MS

function frame_of(keyed: ReadonlyArray<KeyedLine>, is_decoding: boolean): TypingFrame {
	return { keyed, known: new Set(keyed.map((line) => line.key)), is_decoding }
}

// The typing a frame of `keyed` starts after an empty base.
function typing_of(keyed: ReadonlyArray<KeyedLine>, is_decoding = true): ReturnType<typeof next> {
	const base = next(NO_TYPING, frame_of([], is_decoding), START, true)

	return next(base, frame_of(keyed, is_decoding), START + SECOND, true)
}

function keys_at(
	keyed: ReadonlyArray<KeyedLine>,
	now_ms: number,
	is_decoding = true,
): Array<string> {
	const typing = typing_of(keyed, is_decoding)

	return next(typing, frame_of(keyed, is_decoding), now_ms, true).lines.map((line) => line.key)
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_type_glow.glowed', () => {
	it('paints the block and the two newest letters white, the letters before them bright', () => {
		const line = glowed(TEXT, { prefix_columns: 6, columns: 9, since_typed_ms: -LETTER_MS })
		const prefix = run_board_cut_styled.cut_styled(TEXT, 6)

		const head = painted(SHADES.head, `BC${CURSOR}`)

		expect(line).toBe(`${prefix}${painted(SHADES.bright, 'A')}${head}`)
		expect(painted(SHADES.head, 'x')).toContain(WHITE)
		expect(painted(SHADES.bright, 'x')).toContain(BRIGHT)
	})

	it('paints the first letter and the block white, with no bright part yet', () => {
		const line = glowed(TEXT, { prefix_columns: 6, columns: 7, since_typed_ms: -LETTER_MS })

		const head = painted(SHADES.head, `A${CURSOR}`)

		expect(line).toBe(`${run_board_cut_styled.cut_styled(TEXT, 6)}${head}`)
	})

	it.each([0, GLOW_MS - 1])('keeps the whole line bright %i ms after it types through', (since) => {
		const line = glowed(TEXT, { prefix_columns: 6, columns: 11, since_typed_ms: since })

		expect(line).toBe(
			`${run_board_cut_styled.cut_styled(TEXT, 6)}${painted(SHADES.bright, 'ABCDE')}`,
		)
	})

	it('draws the line as the frame does half a second after it types through', () => {
		expect(glowed(TEXT, { prefix_columns: 6, columns: 11, since_typed_ms: GLOW_MS })).toBe(TEXT)
	})

	it('glows the header’s now line alone', () => {
		expect(glows(NOW.key)).toBe(true)
		expect(glows(ROW.key)).toBe(false)
	})
})

describe('run_board_type_rows — the glowing now line where the rows decode', () => {
	it('types the now line with its block and decodes every other row', () => {
		const typing = typing_of([NOW, ROW])
		const at_ms = START + SECOND + 2 * LETTER_MS
		const [now = '', row = ''] = typed_lines([TEXT, ROW.text], typing, at_ms)

		expect(stripVTControlCharacters(now)).toBe(`${PREFIX}ABC${CURSOR}`)
		expect(now).toContain(WHITE)
		expect(row).not.toContain(CURSOR)
		expect(type_bytes(typing, at_ms)).toContain(WHITE)
	})

	it('keeps the now line glowing for half a second after it types through, then drops it', () => {
		expect(keys_at([NOW], TYPED_MS + GLOW_MS - 1)).toStrictEqual([NOW.key])
		expect(keys_at([NOW], TYPED_MS + GLOW_MS)).toStrictEqual([])
	})

	it('drops the now line once typed through where the rows type', () => {
		expect(keys_at([NOW], TYPED_MS, false)).toStrictEqual([])
	})

	it('writes the now line as the frame draws it once the glow is over', () => {
		const typing = next(typing_of([NOW]), frame_of([NOW], true), TYPED_MS, true)

		expect(type_bytes(typing, TYPED_MS + GLOW_MS)).toContain(TEXT)
		expect(type_bytes(typing, TYPED_MS + GLOW_MS)).not.toContain(BRIGHT)
	})
})
