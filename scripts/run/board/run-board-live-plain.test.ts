import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import { run_board_header_names } from './run-board-header-names'
import type { KeyInput } from './run-board-keys'
import { run_board_live } from './run-board-live'
import { run_board_paint } from './run-board-paint'
import { run_board_panel_fixture } from './run-board-panel-fixture'
import type { TypingSound } from './run-board-sound-typing'
import type { Theme } from './run-board-theme'

// joshuafolkken/kit#8917 (Issue 4-3, 4-4): a theme is drawn by its theme run alone. A terminal without
// 24-bit color draws a themed board as the board in no theme — no theme layer, no trill, Ctrl-C leaving
// at once — and demo mode's `0` shows the board in no theme at once, its base restyled in no theme.

const { IDLE_ROW, LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
// A read with throughput rows, beside which the lamp panel a theme lays out by runs, on the real
// board's pane with its usage reads: a themed board with no such panel on screen draws in no theme
// (joshuafolkken/kit#8917).
const PANELED = { ...LOCAL, throughput: [IDLE_ROW, IDLE_ROW] }
const { PANE, paneled } = run_board_panel_fixture
const { cell_at, lines_of, terminal_of } = run_board_frame_fixture
const CTRL_C = '\u{3}'
const BASE_GREEN = '38;2;0;215;60'
const { BOARD_NAME } = run_board_header_names
const KANA = /[ｦ-ﾝ]/u
const STOP_AFTER_MS = 3000
const NAMED_DEPTH = 8
const RGB = run_board_paint.RGB_COLOR_DEPTH

interface Keyboard {
	input: KeyInput
	type: (chunk: string) => void
	interrupts: Array<number>
}

// A keyboard on a terminal; `type` hands it a key, and each Ctrl-C it passes on is counted.
function keyboard(): Keyboard {
	const held: { on_data: ((chunk: string) => void) | undefined } = { on_data: undefined }
	const interrupts: Array<number> = []
	const input: KeyInput = {
		is_tty: true,
		raw: () => undefined,
		listen: (on_data) => {
			held.on_data = on_data
		},
		close: () => undefined,
		interrupt: () => {
			interrupts.push(interrupts.length)
		},
	}

	return { input, type: (chunk) => held.on_data?.(chunk), interrupts }
}

// The trill's switches.
function trill(switched: Array<string>): TypingSound {
	return {
		set: (is_on) => {
			switched.push(is_on ? 'on' : 'off')
		},
		stop: () => {
			switched.push('stop')
		},
	}
}

interface Watched {
	frames: Array<string>
	switched: Array<string>
	interrupts: Array<number>
}

// A sleep that moves the board's clock on by what it waits, and stops the board once enough has passed.
function clocked(clock: { now_ms: number }): (ms: number) => Promise<void> {
	const stop_at = clock.now_ms + STOP_AFTER_MS

	return async (ms) => {
		clock.now_ms += ms
		if (clock.now_ms > stop_at) throw STOPPED
	}
}

// A live board in `theme` on a terminal of `depth` colors, the keys `typed` handed it as it opens.
async function watched(theme: Theme | undefined, depth: number, typed = ''): Promise<Watched> {
	const read = harness(PANELED, [plan_titled('a')])
	const { frames, clock } = read
	const keys = keyboard()
	const switched: Array<string> = []
	const ports = { ...paneled(read), sleep: clocked(clock) }
	const board = { ...ports, keys: keys.input, typing_sound: trill(switched) }
	const watching = run_board_live.watch({ ...board, color_depth: () => depth }, theme)

	for (const key of typed) keys.type(key)
	await expect(watching).rejects.toBe(STOPPED)

	return { frames, switched, interrupts: keys.interrupts }
}

// The screen the board's writes left before it left the alternate screen: every cell's style, and its
// text.
function screen_left(frames: ReadonlyArray<string>): { styles: Array<string>; text: string } {
	const cells = terminal_of(frames.slice(0, -1), PANE)
	const styles = Array.from({ length: cells.rows }, (_, row) =>
		Array.from(
			{ length: cells.columns },
			(_unused, column) => cell_at(cells, row + 1, column + 1).sgr,
		),
	).flat()

	return { styles, text: lines_of(cells).join('\n') }
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_live.watch without 24-bit color', () => {
	it('draws a themed board exactly as the board in no theme', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const themed = await watched('wopr', NAMED_DEPTH)
		const plain = await watched(undefined, NAMED_DEPTH)

		expect(themed.frames.length).toBeGreaterThan(1)
		expect(themed.frames).toStrictEqual(plain.frames)
		expect(themed.frames.join('')).not.toContain(BASE_GREEN)
	})

	it('sounds no trill and leaves at once on Ctrl-C', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { switched, interrupts } = await watched('wopr', NAMED_DEPTH, CTRL_C)

		expect(switched).toStrictEqual(['stop'])
		expect(interrupts).toHaveLength(1)
	})
})

describe('run_board_live.watch demo mode 0', () => {
	// The theme layer paints every cell of the base look in the theme's own colors, so what shows is the
	// theme — here its opening, still playing — and none of the base's green.
	it('draws a themed board in 24-bit color through its theme', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { frames } = await watched('wopr', RGB)
		const { styles, text } = screen_left(frames)

		expect(text).toContain('SHALL WE PLAY A GAME?')
		expect(styles.some((sgr) => sgr.includes(BASE_GREEN))).toBe(false)
	})

	// A key skips the opening, `/` enters demo mode and `0` picks no theme; the redraw after it draws
	// the board in no theme.
	it('restyles the base in no theme once demo mode picks none', async () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const { frames } = await watched('wopr', RGB, 'x/0')
		const { styles, text } = screen_left(frames)

		expect(styles.some((sgr) => sgr.includes(BASE_GREEN))).toBe(false)
		expect(text).toContain(BOARD_NAME)
		expect(text).not.toMatch(KANA)
	})
})
