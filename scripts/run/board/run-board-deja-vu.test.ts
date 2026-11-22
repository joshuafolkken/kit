import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_deja_vu } from './run-board-deja-vu'
import { run_board_frame_diff } from './run-board-frame-diff'
import { run_board_rain } from './run-board-rain'
import type { KeyedLine } from './run-board-type-rows'

const { END_FRAMES, bytes, is_on, next, shifted } = run_board_deja_vu
const { CSI, FRAME_MS, HEAD } = run_board_frame_diff
const GREEN = '\u{1B}[32m'
// Random draws above and below the quarter that swaps a glyph.
const KEEP_DRAW = 0.5
const SWAP_DRAW = 0.2

function keep(): number {
	return KEEP_DRAW
}

function swap(): number {
	return SWAP_DRAW
}

const KANA = run_board_rain.fresh(swap)

function lane(text: string, row = 2): KeyedLine {
	return { text, key: 'lanes:1', row, index: row - 1, prefix_columns: 0 }
}

// A replay started at the first frame by lane 1 failing.
function failed(): { lines: Array<KeyedLine>; deja_vu: ReturnType<typeof next> } {
	const lines = [lane('💥 #1 ab')]
	const base = { lines: [lane('🔨 #1 ab')], deja_vu: [] }

	return { lines, deja_vu: next(base, lines, 0) }
}

describe('run_board_deja_vu.is_on', () => {
	it.each([
		[0, true],
		[1, true],
		[2, false],
		[4, false],
		[5, true],
		[6, true],
		[7, false],
	])('ac-f699b434 draws two frames twice with three frames between: frame %s → %s', (age, on) => {
		expect(is_on(age)).toBe(on)
	})
})

describe('run_board_deja_vu.shifted', () => {
	it('ac-f699b434 moves the row three columns right at its own width', () => {
		expect(shifted('abcdef', keep)).toBe('   abc')
		expect(shifted('ab', keep)).toBe('  ')
	})

	it('ac-f699b434 swaps a quarter of the drawn glyphs for rain glyphs, never a blank', () => {
		expect(shifted('a b c d e', swap)).toBe(`   ${KANA} ${KANA} ${KANA} `)
		expect(shifted('abcd', (): number => 0.25)).toBe('   a')
	})

	it.each([
		['界ab界', '   界a'],
		['ab界c', '   ab'],
		[`${GREEN}ab\u{1B}[31mcd`, '   a'],
	])('ac-b9a692bb keeps %j its width with ANSI dropped and wide glyphs whole', (text, expected) => {
		const drawn = shifted(text, keep)

		expect(drawn).toBe(expected)
		expect(stringWidth(drawn)).toBe(stringWidth(text))
	})

	it('ac-b9a692bb pads a wide glyph swapped for a rain glyph to its width', () => {
		expect(shifted('a界bcd', swap)).toBe(`   ${KANA}${KANA} `)
		expect(stringWidth(shifted('a界bcd', swap))).toBe(6)
	})
})

describe('run_board_deja_vu.bytes', () => {
	it('ac-f699b434 writes the shifted row in the head color over a burst', () => {
		const expected = run_board_cut_styled.cut_styled(
			`${HEAD}${shifted('💥 #1 ab', keep)}`,
			Infinity,
		)

		expect(bytes(failed(), 0, undefined, keep)).toBe(`${CSI}2;1H${expected}`)
		expect(bytes(failed(), FRAME_MS * 5, undefined, keep)).toContain(HEAD)
	})

	it.each([2, 4, END_FRAMES])('ac-f699b434 writes the row as drawn at frame %s', (age) => {
		const restored = run_board_cut_styled.cut_styled('💥 #1 ab', Infinity)

		expect(bytes(failed(), age * FRAME_MS, undefined, keep)).toBe(`${CSI}2;1H${restored}`)
	})

	it('writes nothing more once restored before the last write', () => {
		const since = { ms: END_FRAMES * FRAME_MS }

		expect(bytes(failed(), since.ms + FRAME_MS, since, keep)).toBe('')
		expect(bytes(failed(), since.ms, { ms: since.ms - FRAME_MS }, keep)).not.toBe('')
	})
})

describe('run_board_deja_vu.next', () => {
	it('ac-3a46d3cd starts a replay only on an event', () => {
		expect(failed().deja_vu).toStrictEqual([{ key: 'lanes:1', start_ms: 0 }])
		expect(next({ lines: [lane('🔨 a')], deja_vu: [] }, [lane('🔨 b')], 0)).toStrictEqual([])
	})

	it('keeps a replay until it ends, its row stays drawn', () => {
		const scene = failed()

		expect(next(scene, scene.lines, (END_FRAMES - 1) * FRAME_MS)).toHaveLength(1)
		expect(next(scene, scene.lines, END_FRAMES * FRAME_MS)).toStrictEqual([])
		expect(next(scene, [], FRAME_MS)).toStrictEqual([])
	})

	it('restarts a replay on another event on its row', () => {
		const scene = failed()

		expect(next(scene, [lane('💥 💥 #1 ab')], FRAME_MS * 3)).toStrictEqual([
			{ key: 'lanes:1', start_ms: FRAME_MS * 3 },
		])
	})
})
