import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_theme_glyphs } from './run-board-theme-glyphs'

// joshuafolkken/kit#8974: an emoji the glyph table misses is blanks of its width, not `?`.
const { textual } = run_board_theme_glyphs
const FRAME = 'TY unicorn🦄 |'

describe('run_board_theme_glyphs.textual of an emoji the table misses', () => {
	beforeEach(() => {
		vi.stubEnv('FORCE_COLOR', '0')
	})

	it('draws it as blanks of its width, mid-line and at the end', () => {
		expect(textual(FRAME)).toBe('TY unicorn   |')
		expect(textual('a🦄b')).toBe('a  b')
	})

	it.each(['🦄\u{FE0F}', '🧑\u{1F3FD}', '👨\u{200D}👩\u{200D}👧', '🏳\u{FE0F}\u{200D}🌈'])(
		'draws the composed emoji %s as one run of blanks of its width',
		(emoji) => {
			const drawn = textual(`a${emoji}b`)

			expect(drawn).toBe(`a${' '.repeat(run_board_fit.width_of(emoji))}b`)
			expect(run_board_fit.width_of(drawn)).toBe(run_board_fit.width_of(`a${emoji}b`))
		},
	)

	it('keeps drawing a tabled emoji beside one the table misses', () => {
		expect(textual('🦄🔄|')).toBe('  >>|')
	})

	it('keeps the frame as it is with `emoji` icons', () => {
		expect(textual(FRAME, { theme: undefined, icons: 'emoji' })).toBe(FRAME)
		expect(textual(FRAME, { theme: 'wopr', icons: 'emoji' })).toBe(FRAME)
	})
})
