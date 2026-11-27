import { run_board_cells, type Cells } from './run-board-cells'
import { run_board_cells_ansi } from './run-board-cells-ansi'
import type { TerminalSize } from './run-board-fit'
import { run_board_frame_loop, type FrameScreen } from './run-board-frame-loop'
import { run_board_spin } from './run-board-spin'
import type { SpinPorts, Turning } from './run-board-spin-turn'
import type { StallStage } from './run-board-state'

// The frames `spin_to_second` writes (joshuafolkken/kit#8826) read back as a terminal shows them: each
// write painted over the last onto a screen of cells, so a test asserts what is on screen rather than
// the diff's bytes.

const { cells_of, char_text, style_of, CONTINUATION } = run_board_cells
const { MIN_FRAME_MS } = run_board_frame_loop
const DEFAULT_SIZE: TerminalSize = { rows: 24, columns: 80 }

// The redraw `base` of `size` already on the terminal, as a redraw leaves it, so the first frame writes
// only what the layers draw over it.
function settled(base: string, size: TerminalSize = DEFAULT_SIZE): FrameScreen {
	const screen = run_board_frame_loop.screen_of()

	run_board_frame_loop.revealed(screen, base, size)

	return screen
}

// `spin_to_second` on `screen`, a settled blank one where none is given.
async function spin_to_second(
	turning: Turning,
	ports: SpinPorts,
	screen: FrameScreen = settled('', ports.size?.()),
): Promise<void> {
	await run_board_spin.spin_to_second(turning, ports, screen)
}

// A write as its bytes, or a test's record of one: the bytes as written, or without their sync marks.
type Written = string | { raw: string } | { text: string }

function bytes_of(write: Written): string {
	if (typeof write === 'string') return write

	return 'raw' in write ? write.raw : write.text
}

// `writes` painted in order onto a blank screen of `size`.
function terminal_of(writes: ReadonlyArray<Written>, size: TerminalSize = DEFAULT_SIZE): Cells {
	const cells = cells_of(size)

	for (const write of writes) run_board_cells_ansi.paint(cells, bytes_of(write))

	return cells
}

// The screen after each of `writes`, in order.
function screens_of(
	writes: ReadonlyArray<Written>,
	size: TerminalSize = DEFAULT_SIZE,
): Array<Cells> {
	return writes.map((_, index) => terminal_of(writes.slice(0, index + 1), size))
}

// Whether a frame was made at `due_ms` or within the one refresh the frame loop may hold it back by.
function is_near(at_ms: ReadonlyArray<number>, due_ms: number): boolean {
	return at_ms.some((at) => at >= due_ms && at < due_ms + MIN_FRAME_MS)
}

// The characters of row `row` (1-based), trailing blanks dropped.
function row_text(cells: Cells, row: number): string {
	const start = (row - 1) * cells.columns
	const chars = [...cells.chars.subarray(start, start + cells.columns)]

	return chars
		.filter((char) => char !== CONTINUATION)
		.map((char) => char_text(char))
		.join('')
		.trimEnd()
}

// The character and SGR of the cell at `row`, `column` (both 1-based).
function cell_at(cells: Cells, row: number, column: number): { char: string; sgr: string } {
	const index = (row - 1) * cells.columns + column - 1

	return {
		char: char_text(cells.chars[index] ?? CONTINUATION),
		sgr: style_of(cells.styles[index] ?? 0).sgr,
	}
}

// The rows on screen, trailing blank rows dropped.
function lines_of(cells: Cells): Array<string> {
	const rows = Array.from({ length: cells.rows }, (_, index) => row_text(cells, index + 1))
	const last = rows.findLastIndex((row) => row !== '')

	return rows.slice(0, last + 1)
}

// `visit` handed the screen after each of `writes`, painted one onto the last; the screen is reused.
function each_screen(
	writes: ReadonlyArray<Written>,
	visit: (cells: Cells, index: number) => void,
	size: TerminalSize = DEFAULT_SIZE,
): void {
	const cells = cells_of(size)

	for (const [index, write] of writes.entries()) {
		run_board_cells_ansi.paint(cells, bytes_of(write))
		visit(cells, index)
	}
}

// What an SGR's codes leave on: dim, and the foreground's codes.
interface Attributes {
	is_dim: boolean
	fg: string | undefined
}

// eslint-disable-next-line no-control-regex -- an SGR opens with ESC
const SGR = /\u{1B}\[([\d;]*)m/gu
const EXTENDED_FG = 38
const EXTENDED_BG = 48
const EXTENDED = new Set([EXTENDED_FG, EXTENDED_BG])
const TRUE_COLOR = 2
const TRUE_COLOR_CODES = 5
const INDEXED_CODES = 3
const FG_LOW = 30
const FG_COLORS = 8
const DIM = 2
const NORMAL_INTENSITY = 22
const DEFAULT_FG = 39
const FG_CODES = new Set([
	...Array.from({ length: FG_COLORS }, (_, index) => FG_LOW + index),
	EXTENDED_FG,
])
// What each code a test reads does to the attributes.
const EFFECTS = new Map<number, Partial<Attributes>>([
	[0, { is_dim: false, fg: undefined }],
	[DIM, { is_dim: true }],
	[NORMAL_INTENSITY, { is_dim: false }],
	[DEFAULT_FG, { fg: undefined }],
])

// How many codes the code at `index` takes: `38;2;r;g;b` or `38;5;n` for an extended color, the
// background's `48;…` alike (its `2` is not dim).
function code_length(codes: ReadonlyArray<number>, index: number): number {
	if (!EXTENDED.has(codes[index] ?? 0)) return 1

	return codes[index + 1] === TRUE_COLOR ? TRUE_COLOR_CODES : INDEXED_CODES
}

// `attributes` with the one code at `index` applied; how many codes it took.
function apply(attributes: Attributes, codes: ReadonlyArray<number>, index: number): number {
	const code = codes[index] ?? 0
	const length = code_length(codes, index)
	const fg = FG_CODES.has(code) ? { fg: codes.slice(index, index + length).join(';') } : {}

	Object.assign(attributes, EFFECTS.get(code) ?? {}, fg)

	return length
}

// The attributes a cell's SGR leaves on, its codes applied in order.
function attributes_of(sgr: string): Attributes {
	const attributes: Attributes = { is_dim: false, fg: undefined }
	const codes = [...sgr.matchAll(SGR)].flatMap(([, params = '']) => params.split(';').map(Number))

	for (let index = 0; index < codes.length; index += apply(attributes, codes, index)) {
		// each code applied by the step
	}

	return attributes
}

const RULE_CHARS = new Set(['-', '─'])
const RULE_RUN = 10

// The cells of row `row` that sit in a run of at least `RULE_RUN` rule characters.
function row_rule_cells(cells: Cells, row: number): Array<{ char: string; sgr: string }> {
	const row_cells = Array.from({ length: cells.columns }, (_, index) =>
		cell_at(cells, row, index + 1),
	)
	const runs = row_cells.map((cell) => (RULE_CHARS.has(cell.char) ? 1 : 0)).join('')

	return [...runs.matchAll(new RegExp(`1{${String(RULE_RUN)},}`, 'gu'))].flatMap((run) =>
		row_cells.slice(run.index, run.index + run[0].length),
	)
}

// Every cell on screen in a run of rule characters — a section rule's, not a clock's dashes.
function rule_cells(cells: Cells): Array<{ char: string; sgr: string }> {
	return Array.from({ length: cells.rows }, (_, index) => row_rule_cells(cells, index + 1)).flat()
}

// The stage each redraw and spin enters, and how many writes were made before it.
interface Stage {
	stage: StallStage
	written: number
}

// An `enter_stage` port recording into `stages` against `writes`.
function stage_log(writes: ReadonlyArray<unknown>): {
	stages: Array<Stage>
	enter_stage: (stage: StallStage) => void
} {
	const stages: Array<Stage> = []

	return {
		stages,
		enter_stage: (stage) => {
			stages.push({ stage, written: writes.length })
		},
	}
}

const SYNC_START = '\u{1B}[?2026h'
const SYNC_END = '\u{1B}[?2026l'

// Whether `write` is one synchronized block and nothing outside it.
function is_synced_once(write: string): boolean {
	return (
		write.startsWith(SYNC_START) &&
		write.endsWith(SYNC_END) &&
		!write.includes(SYNC_START, 1) &&
		!write.slice(0, -SYNC_END.length).includes(SYNC_END)
	)
}

// A write's bytes inside its synchronized output (joshuafolkken/kit#8125); a write outside it is kept
// whole, so it matches none of the turns it should have been.
function unsynced(text: string): string {
	if (!text.startsWith(SYNC_START) || !text.endsWith(SYNC_END)) return text

	return text.slice(SYNC_START.length, -SYNC_END.length)
}

// A write a test saw: when, the bytes inside its synchronized output, and the write as it was.
interface SpinWrite {
	at_ms: number
	text: string
	raw: string
}

// A clock that each sleep moves forward, and every write and sleep it saw; each write also moves it by
// `write_ms`, as a terminal slow to take a frame does (joshuafolkken/kit#8936).
function spin_ports(
	now_ms: number,
	write_ms = 0,
): {
	ports: SpinPorts
	writes: Array<SpinWrite>
	sleeps: Array<number>
} {
	const clock = { now_ms }
	const writes: Array<SpinWrite> = []
	const sleeps: Array<number> = []
	const ports: SpinPorts = {
		now: () => clock.now_ms,
		write: (raw: string) => {
			writes.push({ at_ms: clock.now_ms, text: unsynced(raw), raw })
			clock.now_ms += write_ms
		},
		sleep: async (ms: number) => {
			sleeps.push(ms)
			clock.now_ms += ms
		},
	}

	return { ports, writes, sleeps }
}

const run_board_frame_fixture = {
	attributes_of,
	is_synced_once,
	cell_at,
	each_screen,
	is_near,
	lines_of,
	row_text,
	rule_cells,
	screens_of,
	settled,
	spin_ports,
	spin_to_second,
	stage_log,
	terminal_of,
}

export { run_board_frame_fixture }
export type { Stage }
