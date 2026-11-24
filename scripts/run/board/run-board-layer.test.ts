import { describe, expect, it } from 'vitest'
import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import { run_board_layer, type GlyphBytes } from './run-board-layer'

// joshuafolkken/kit#8826: a layer's next change and its cells; a provisional layer's bytes kept on an
// overlay drawn over the canvas.

const { NEVER, boundary_after, bytes_layer, every, glyph_layer, never } = run_board_layer
const { cells_of, char_text } = run_board_cells
const SIZE = { rows: 1, columns: 4 }
const STEP_MS = 80

function row_of(cells: Cells): string {
	return [...cells.chars].map((char) => char_text(char)).join('')
}

function canvas_of(text: string): Cells {
	const canvas = cells_of(SIZE)

	run_board_cells_ansi.paint(canvas, text)

	return canvas
}

describe('run_board_layer.boundary_after', () => {
	it('is the next multiple of the interval, never now', () => {
		expect(boundary_after(0, STEP_MS)).toBe(STEP_MS)
		expect(boundary_after(STEP_MS - 1, STEP_MS)).toBe(STEP_MS)
		expect(boundary_after(STEP_MS, STEP_MS)).toBe(STEP_MS * 2)
	})
})

describe('run_board_layer.every / never', () => {
	it('steps on the interval while on and never otherwise', () => {
		expect(every(true, STEP_MS)(1)).toBe(STEP_MS)
		expect(every(false, STEP_MS)(1)).toBe(NEVER)
		expect(never()).toBe(NEVER)
	})
})

describe('run_board_layer.bytes_layer', () => {
	it('puts what it wrote over the canvas and leaves the rest', () => {
		const layer = bytes_layer(() => '\u{1B}[1;2Hx', never)
		const canvas = canvas_of('1234')

		layer.draw(canvas, 0)

		expect(row_of(canvas)).toBe('1x34')
		expect(layer.is_decor).toBe(true)
	})

	it('hands the moment it last drew at, and paints again only at a new one', () => {
		const calls: Array<[number, number | undefined]> = []
		const layer = bytes_layer((at_ms, since_ms) => {
			calls.push([at_ms, since_ms])

			return `\u{1B}[1;${String(at_ms + 1)}Hy`
		}, never)
		const canvas = canvas_of('1234')

		layer.draw(canvas, 0)
		layer.draw(canvas_of('1234'), 0)
		layer.draw(canvas, 1)

		expect(calls).toStrictEqual([
			[0, undefined],
			[1, 0],
		])
		expect(row_of(canvas)).toBe('yy34')
	})

	it('keeps its earlier writes on the overlay for a fresh canvas', () => {
		const layer = bytes_layer((at_ms) => `\u{1B}[1;${String(at_ms + 1)}Hz`, never, false)
		const canvas = canvas_of('1234')

		layer.draw(canvas_of('1234'), 0)
		layer.draw(canvas, 2)

		expect(row_of(canvas)).toBe('z2z4')
		expect(layer.is_decor).toBe(false)
	})
})

// Each place's style and text, given as `[place, text, style]`.
function glyphs(entries: Array<[string, string, string?]>): () => ReadonlyMap<string, GlyphBytes> {
	return () => new Map(entries.map(([key, text, style = '']) => [key, { style, text }]))
}

describe('run_board_layer.glyph_layer', () => {
	it('puts each glyph at its place and leaves the rest', () => {
		const layer = glyph_layer(glyphs([['1;3', 'x', '\u{1B}[31m']]), never)
		const canvas = canvas_of('1234')

		layer.draw(canvas, 0)

		expect(row_of(canvas)).toBe('12x4')
		expect(run_board_cells.style_of(canvas.styles[2] ?? 0).sgr).toContain('31')
	})

	it('gives a wide character two cells', () => {
		const layer = glyph_layer(glyphs([['1;2', '漢', '\u{1B}[32m']]), never)
		const canvas = canvas_of('1234')

		layer.draw(canvas, 0)

		expect(canvas.chars[1]).toBe('漢'.codePointAt(0))
		expect(canvas.chars[2]).toBe(run_board_cells.CONTINUATION)
		expect(canvas.chars[3]).toBe('4'.codePointAt(0))
		expect(run_board_cells.style_of(canvas.styles[2] ?? 0).sgr).toContain('32')
	})

	it('gives every text in one style that style', () => {
		const style = '\u{1B}[38;2;1;2;3m'
		const layer = glyph_layer(
			glyphs([
				['1;1', 'a', style],
				['1;2', 'b', style],
			]),
			never,
		)
		const canvas = canvas_of('1234')

		layer.draw(canvas, 0)

		expect(row_of(canvas)).toBe('ab34')
		expect(canvas.styles[0]).toBe(canvas.styles[1])
		expect(run_board_cells.style_of(canvas.styles[0] ?? 0).sgr).toContain('38;2;1;2;3')
	})
})

describe('run_board_layer.glyph_layer — what it leaves', () => {
	it('ignores a place off the canvas', () => {
		const off = glyphs([
			['2;1', 'x'],
			['1;5', 'y'],
			['0;1', 'z'],
			['3', 'w'],
		])
		const canvas = canvas_of('1234')

		glyph_layer(off, never).draw(canvas, 0)

		expect(row_of(canvas)).toBe('1234')
	})

	it('draws only what it puts at the moment', () => {
		const layer = glyph_layer(
			(at_ms) => glyphs([at_ms === 0 ? ['1;1', 'a'] : ['1;4', 'b']])(),
			never,
			false,
		)
		const first = canvas_of('1234')
		const second = canvas_of('1234')

		layer.draw(first, 0)
		layer.draw(second, 1)

		expect(row_of(first)).toBe('a234')
		expect(row_of(second)).toBe('123b')
		expect(layer.is_decor).toBe(false)
	})
})
