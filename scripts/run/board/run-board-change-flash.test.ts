import { describe, expect, it } from 'vitest'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_deja_vu } from './run-board-deja-vu'
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

function lane(text: string): Array<KeyedLine> {
	return [{ text, key: 'lanes:1', row: 1, index: 0, prefix_columns: 0 }]
}

describe('run_board_change_flash deja vu', () => {
	const FAILED = lane('💥 #1')

	function replayed(): ReturnType<typeof next> {
		return next(next(undefined, lane('🔨 #1'), 0), FAILED, 0)
	}

	it.each([
		[0, true],
		[1, true],
		[3, false],
		[5, true],
		[run_board_deja_vu.END_FRAMES, false],
	])('ac-f699b434 replays the failed row at frame %s: %s', (age, on) => {
		const written = bytes(replayed(), age * FRAME_MS)

		expect(written.startsWith(`${CSI}1;1H${HEAD}`)).toBe(on)
		expect(written).toContain(`${CSI}1;1H`)
	})

	it('keeps the spin writing until the replay ends, then lets it rest', () => {
		const replaying = next(replayed(), FAILED, (run_board_deja_vu.END_FRAMES - 1) * FRAME_MS)
		const rested = next(replayed(), FAILED, COOL_FRAMES * FRAME_MS)

		expect(replaying.deja_vu).toHaveLength(1)
		expect(run_board_change_flash.is_lit({ ...replaying, cells: [] })).toBe(true)
		expect(run_board_change_flash.is_lit(rested)).toBe(false)
	})

	it('draws a flashing glyph over the replayed row', () => {
		const flash = next(next(undefined, lane('🔨 #1'), 0), lane('💥 #2'), 0)
		const written = bytes(flash, 2 * FRAME_MS)

		expect(written.indexOf(`${HEAD}2`)).toBeGreaterThan(written.indexOf('💥 #2'))
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
