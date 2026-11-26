import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cells } from './run-board-cells'
import type { TerminalSize } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import { run_board_fold } from './run-board-fold'
import { run_board_frame_fixture } from './run-board-frame-fixture'
import type { KeyInput } from './run-board-keys'
import { run_board_labels } from './run-board-labels'
import { run_board_live } from './run-board-live'
import { run_board_paint } from './run-board-paint'

// Demo mode on a live board ends the frame on its own footer — the work picked and every key, the
// picked work's lit — in place of the legend and the footer, and leaving it brings both back.

const { LOCAL, STOPPED, harness, plan_titled } = run_board_fixture
const { attributes_of, cell_at, lines_of, terminal_of } = run_board_frame_fixture
const { WORDS } = run_board_labels
const RGB = { color_depth: () => run_board_paint.RGB_COLOR_DEPTH }
const KEYS_LEAD = /^ {2}KEYS {2}/iu
const FOLD_KEYS = run_board_fold.KEYS_LINE.trim()
// A pane the board fits in, and one too short for it; the selector's rows in a pane this wide.
const PANE: TerminalSize = { rows: 24, columns: 80 }
const SHORT: TerminalSize = { rows: 8, columns: 80 }
const EXIT = '/ EXIT'
const SELECTOR = [
	'',
	'  [0] none - [s] IDLE',
	'  KEYS  0 none   1 wopr   2 trace   3 flux   4 codec   5 nixie   6 skynet',
	'        7 magi',
	`        s IDLE   a PROGRESS   d ROW   w NOTICE   q OPENING   e ENDING   ${EXIT}`,
]

afterEach(() => {
	vi.unstubAllEnvs()
})

// A keyboard `type` hands keys to.
function keyboard(): { input: KeyInput; type: (chunk: string) => void } {
	const held: { on_data: ((chunk: string) => void) | undefined } = { on_data: undefined }
	const input: KeyInput = {
		is_tty: true,
		raw: () => undefined,
		listen: (on_data) => {
			held.on_data = on_data
		},
		close: () => undefined,
		interrupt: () => undefined,
	}

	return { input, type: (chunk) => held.on_data?.(chunk) }
}

// The board watched while `presses` are typed, one as each redraw begins; the screen as each redraw
// began — the one after a press shows what that press drew — and the one the board left.
async function watched(
	presses: ReadonlyArray<string>,
	size: TerminalSize = PANE,
): Promise<Array<Cells>> {
	vi.stubEnv('FORCE_COLOR', '3')
	const board = harness(LOCAL, [plan_titled('a')])
	const { input, type } = keyboard()
	const screens: Array<Cells> = []
	const ports = {
		...board.ports,
		...RGB,
		keys: input,
		size: () => size,
		enter_stage: (stage: string) => {
			if (stage !== 'redraw') return
			screens.push(terminal_of(board.frames, size))
			type(presses[screens.length - 1] ?? '')
		},
		sleep: async (ms: number) => {
			board.clock.now_ms += ms
			if (screens.length > presses.length) await board.ports.sleep(ms)
		},
	}

	await expect(run_board_live.watch(ports, undefined)).rejects.toBe(STOPPED)

	return screens
}

// The keys row's text drawn at full brightness: the picked work's key and name.
function lit_of(screen: Cells): string {
	const row = lines_of(screen).findIndex((line) => KEYS_LEAD.test(line)) + 1
	const cells = Array.from({ length: screen.columns }, (_, index) =>
		cell_at(screen, row, index + 1),
	)

	return cells
		.filter(({ sgr }) => !attributes_of(sgr).is_dim)
		.map(({ char }) => char)
		.join('')
		.trim()
}

function has(screen: Cells | undefined, text: string): boolean {
	return screen !== undefined && lines_of(screen).some((line) => line.includes(text))
}

// Whether the screen draws the normal footer's two lines.
function footer_of(screen: Cells | undefined): Array<boolean> {
	return [has(screen, WORDS.keeps_running), has(screen, FOLD_KEYS)]
}

// The screen's last rows, as many as the selector takes.
function ending_of(screen: Cells | undefined): Array<string> {
	return screen === undefined ? [] : lines_of(screen).slice(-SELECTOR.length)
}

describe('run_board_live.watch demo mode footer', () => {
	it('ends the frame on the selector in place of the footer once / enters demo mode', async () => {
		const [, entered] = await watched(['/'])

		expect(footer_of(entered)).toStrictEqual([false, false])
		expect(ending_of(entered)).toStrictEqual(SELECTOR)
		expect(entered === undefined ? '' : lit_of(entered)).toBe('0 none')
	})

	// The wargames board writes its base in capitals, the selector with it.
	it('moves the picked work’s light as a digit picks another', async () => {
		const [, entered, picked] = await watched(['/', '1', '0'])
		const lit = picked === undefined ? '' : lit_of(picked)

		expect(has(entered, '  [0] none')).toBe(true)
		expect(has(picked, '  [1] WOPR')).toBe(true)
		expect(lit).toBe('1 WOPR')
	})

	it('brings the footer back as / leaves demo mode', async () => {
		const [, entered, left] = await watched(['/', '/'])

		expect(has(entered, EXIT)).toBe(true)
		expect(footer_of(left)).toStrictEqual([true, true])
		expect(has(left, EXIT)).toBe(false)
	})

	it('keeps the selector whole in a pane too short for the board', async () => {
		const [, normal] = await watched([''], SHORT)
		const [, entered] = await watched(['/'], SHORT)
		const lines = entered === undefined ? [] : lines_of(entered)

		expect(normal === undefined ? [] : lines_of(normal)).not.toHaveLength(0)
		expect(footer_of(normal)).toStrictEqual([false, false])
		expect(lines).toHaveLength(SHORT.rows)
		expect(ending_of(entered)).toStrictEqual(SELECTOR)
		expect(lines[0]).toContain('josh-board')
	})
})

// joshuafolkken/kit#8969: what a key plays is named on the frame the key starts it on.
describe('run_board_live.watch demo mode footer naming what plays', () => {
	it('names what a key plays on the next frame, IDLE again after a work is picked', async () => {
		const screens = await watched(['/', '1', 'w', '2'])
		const [wopr, noticed, picked] = screens.slice(2)

		expect(has(wopr, '  [1] WOPR - [S] IDLE')).toBe(true)
		expect(has(noticed, '  [1] WOPR - [W] NOTICE')).toBe(true)
		expect(has(picked, '  [2] trace - [s] IDLE')).toBe(true)
	})
})
