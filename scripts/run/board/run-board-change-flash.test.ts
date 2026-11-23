import { WriteStream } from 'node:tty'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_change_flash } from './run-board-change-flash'
import { run_board_deja_vu } from './run-board-deja-vu'
import { run_board_frame_diff } from './run-board-frame-diff'
import type { KeyedLine } from './run-board-type-rows'

const { next, bytes, wake_after, HEAD, FADE_TICKS, TICK_MS } = run_board_change_flash
const { FRAME_MS } = run_board_frame_diff
const GREEN = '\u{1B}[32m'
const RED = '\u{1B}[31m'
const CSI = '\u{1B}['
const OWN = `${CSI}38;2;10;20;30m`
const RGB_DEPTH = 24
const PALETTE_DEPTH = 8

function lines(text: string): Array<KeyedLine> {
	return [{ text, key: 'lane:1', row: 1, index: 0, prefix_columns: 0 }]
}

function flashed(style = GREEN, text = 'b'): ReturnType<typeof next> {
	return next(next(undefined, lines(`${style}a`), 0), lines(`${style}${text}`), 0)
}

function depth(value: number): void {
	vi.spyOn(WriteStream.prototype, 'getColorDepth').mockReturnValue(value)
}

beforeEach(() => {
	depth(RGB_DEPTH)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_change_flash', () => {
	it.each([
		[0, GREEN, `${HEAD}ｱ`],
		[1, GREEN, `${HEAD}ｳ`],
		[2, GREEN, `${CSI}38;2;176;246;189mb`],
		[10, GREEN, `${CSI}38;2;24;219;78mb`],
		[18, GREEN, `${CSI}38;2;3;216;62mb`],
		[FADE_TICKS, GREEN, 'b'],
		[2, OWN, `${CSI}38;2;178;203;182mb`],
	] as const)('ac-8ee7e0d6 fades the glyph at age %s', (age, style, lit) => {
		expect(bytes(flashed(style), age * TICK_MS)).toBe(`${CSI}1;1H${style}${lit}${CSI}0m`)
	})
})

describe('run_board_change_flash decode and palette', () => {
	it.each([
		[0, 'ｱ'],
		[1, 'ｳ'],
		[2, 'b'],
	] as const)('ac-b2a7439a decodes the new glyph as katakana at age %s', (age, glyph) => {
		expect(bytes(flashed(), age * TICK_MS)).toContain(`${glyph}${CSI}0m`)
	})

	it('ac-b2a7439a keeps a blank blank while it decodes', () => {
		expect(bytes(flashed(GREEN, ' '), 0)).toBe(`${CSI}1;1H${GREEN}${HEAD} ${CSI}0m`)
	})

	it.each([
		[0, `${CSI}97m`],
		[1, `${CSI}97m`],
		[2, `${CSI}92m`],
		[18, `${CSI}92m`],
	] as const)('ac-fa8f1814 paints the palette color below 24-bit at age %s', (age, color) => {
		depth(PALETTE_DEPTH)

		expect(bytes(flashed(), age * TICK_MS)).toContain(`${GREEN}${color}`)
	})
})

describe('run_board_change_flash expiry', () => {
	it('writes the restoration once and nothing after expiration', () => {
		const expired_ms = FADE_TICKS * TICK_MS

		expect(bytes(flashed(), expired_ms, { ms: expired_ms - TICK_MS })).toContain('b')
		expect(bytes(flashed(), expired_ms + TICK_MS, { ms: expired_ms })).toBe('')
		expect(next(flashed(), lines(`${GREEN}b`), expired_ms).cells).toStrictEqual([])
	})

	it('renews only the changed cell on another change', () => {
		const now_ms = TICK_MS * 3
		const renewed = next(flashed(), lines(`${GREEN}c`), now_ms)

		expect(renewed.cells).toHaveLength(1)
		expect(bytes(renewed, now_ms)).toContain(HEAD)
	})
})

describe('run_board_change_flash wake', () => {
	it('ac-57779c96 wakes on the next tick while a cell flashes, never once none does', () => {
		const expired = next(flashed(), lines(`${GREEN}b`), FADE_TICKS * TICK_MS)

		expect(wake_after(flashed(), TICK_MS + 1)).toBe(2 * TICK_MS)
		expect(wake_after(flashed(), TICK_MS)).toBe(2 * TICK_MS)
		expect(wake_after(expired, FADE_TICKS * TICK_MS)).toBe(Infinity)
		expect(wake_after(undefined, 0)).toBe(Infinity)
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
		const rested = next(replayed(), FAILED, FADE_TICKS * TICK_MS)

		expect(replaying.deja_vu).toHaveLength(1)
		expect(run_board_change_flash.is_lit({ ...replaying, cells: [] })).toBe(true)
		expect(run_board_change_flash.is_lit(rested)).toBe(false)
	})

	it('draws a flashing glyph over the replayed row', () => {
		const flash = next(next(undefined, lane('🔨 #1'), 0), lane('💥 #2'), 0)
		const written = bytes(flash, 2 * TICK_MS)

		expect(written.indexOf(`${CSI}38;2;176;246;189m2`)).toBeGreaterThan(written.indexOf('💥 #2'))
	})
})

describe('run_board_change_flash redraws', () => {
	it('restores the current style after a color-only redraw', () => {
		const updated = next(flashed(), lines(`${RED}b`), FRAME_MS)

		expect(bytes(updated, FADE_TICKS * TICK_MS)).toContain(`${RED}b`)
	})

	it('drops an active glyph when a redraw removes its row or shortens its line', () => {
		expect(next(flashed(), [], FRAME_MS).cells).toStrictEqual([])
		expect(next(flashed(), lines(''), FRAME_MS).cells).toStrictEqual([])
	})

	it('closes a hyperlink after each overlaid glyph', () => {
		const open = '\u{1B}]8;;https://example.com\u{7}'
		const close = '\u{1B}]8;;\u{7}'
		const flash = next(next(undefined, lines(`${open}a${close}`), 0), lines(`${open}b${close}`), 0)

		expect(bytes(flash, 2 * TICK_MS)).toContain(`b${close}${CSI}0m`)
	})
})
