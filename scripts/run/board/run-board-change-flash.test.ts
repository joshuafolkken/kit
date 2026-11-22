import { describe, expect, it } from 'vitest'
import { run_board_change_flash } from './run-board-change-flash'
import type { KeyedLine } from './run-board-type-rows'

const { next, bytes, HEAD, BRIGHT, FRAME_MS, COOL_FRAMES } = run_board_change_flash
const GREEN = '\u{1B}[32m'
const RED = '\u{1B}[31m'
const CSI = '\u{1B}['

function lines(text: string): Array<KeyedLine> {
	return [{ text, key: 'lane:1', row: 1, index: 0, prefix_columns: 0 }]
}

function flashed(): ReturnType<typeof next> {
	return next(next(undefined, lines(`${GREEN}a`), 0), lines(`${GREEN}b`), 0)
}

describe('run_board_change_flash', () => {
	it.each([
		[0, HEAD],
		[2, HEAD],
		[3, BRIGHT],
		[7, BRIGHT],
		[8, ''],
	] as const)('ac-8de5883d restores the original glyph at age %s', (age, color) => {
		expect(bytes(flashed(), age * FRAME_MS)).toBe(`${CSI}1;1H${GREEN}${color}b${CSI}0m`)
	})

	it('writes the restoration once and nothing after expiration', () => {
		const expired_ms = COOL_FRAMES * FRAME_MS

		expect(bytes(flashed(), expired_ms, { ms: expired_ms - FRAME_MS })).toContain('b')
		expect(bytes(flashed(), expired_ms + FRAME_MS, { ms: expired_ms })).toBe('')
		expect(next(flashed(), lines(`${GREEN}b`), expired_ms).cells).toStrictEqual([])
	})

	it('renews only the changed cell on another change', () => {
		const now_ms = FRAME_MS * 3
		const renewed = next(flashed(), lines(`${GREEN}c`), now_ms)

		expect(renewed.cells).toHaveLength(1)
		expect(bytes(renewed, now_ms)).toContain(`${HEAD}c`)
	})
})

describe('run_board_change_flash redraws', () => {
	it('restores the current style after a color-only redraw', () => {
		const updated = next(flashed(), lines(`${RED}b`), FRAME_MS)

		expect(bytes(updated, COOL_FRAMES * FRAME_MS)).toContain(`${RED}b`)
	})

	it('drops an active glyph when a redraw removes its row or shortens its line', () => {
		expect(next(flashed(), [], FRAME_MS).cells).toStrictEqual([])
		expect(next(flashed(), lines(''), FRAME_MS).cells).toStrictEqual([])
	})

	it('closes a hyperlink after each overlaid glyph', () => {
		const open = '\u{1B}]8;;https://example.com\u{7}'
		const close = '\u{1B}]8;;\u{7}'
		const flash = next(next(undefined, lines(`${open}a${close}`), 0), lines(`${open}b${close}`), 0)

		expect(bytes(flash, 0)).toContain(`b${close}${CSI}0m`)
	})
})
