import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_frame_diff, type ChangedCell } from './run-board-frame-diff'
import { run_board_labels } from './run-board-labels'
import type { BoardPorts } from './run-board-state'
import type { KeyedLine } from './run-board-type-rows'

const CSI = '\u{1B}['
const HEAD = `${CSI}38;2;225;255;225m`
const BRIGHT = `${CSI}38;2;0;255;65m`
const HEAD_FRAMES = 3
const COOL_FRAMES = 8
const FRAME_MS = run_board_labels.SPINNER_INTERVAL_MS

interface FlashCell extends ChangedCell {
	start_ms: number
}

interface Flash {
	lines: ReadonlyArray<KeyedLine>
	cells: ReadonlyArray<FlashCell>
}

function age_of(cell: FlashCell, now_ms: number): number {
	return Math.floor(now_ms / FRAME_MS) - Math.floor(cell.start_ms / FRAME_MS)
}

function identity(cell: ChangedCell): string {
	return `${cell.key}:${String(cell.column)}`
}

function refreshed(cell: FlashCell, lines: ReadonlyArray<KeyedLine>): Array<FlashCell> {
	const line = lines.find((candidate) => candidate.key === cell.key && candidate.row === cell.row)
	const current = run_board_frame_diff
		.cells_of(line?.text ?? '')
		.find((candidate) => candidate.column === cell.column && candidate.text === cell.text)

	return current === undefined ? [] : [{ ...cell, ...current }]
}

function next(last: Flash | undefined, lines: ReadonlyArray<KeyedLine>, now_ms: number): Flash {
	const changes = run_board_frame_diff.changed(last?.lines ?? [], lines)
	const renewed = new Set(changes.map((cell) => identity(cell)))
	const kept = (last?.cells ?? [])
		.filter((cell) => !renewed.has(identity(cell)) && age_of(cell, now_ms) < COOL_FRAMES)
		.flatMap((cell) => refreshed(cell, lines))

	return { lines, cells: [...kept, ...changes.map((cell) => ({ ...cell, start_ms: now_ms }))] }
}

function cell_bytes(cell: FlashCell, now_ms: number): string {
	const age = age_of(cell, now_ms)
	const color = age < HEAD_FRAMES ? HEAD : BRIGHT
	const paint = age < COOL_FRAMES ? color : ''

	const glyph = run_board_cut_styled.cut_styled(`${cell.style}${paint}${cell.text}`, Infinity)

	return `${CSI}${String(cell.row)};${String(cell.column)}H${glyph}`
}

// The moment the last write between redraws was made at, none before the first.
interface Since {
	ms: number
}

// The expiration frame rewrites the original styled glyph once, then leaves it alone.
function bytes(flash: Flash | undefined, now_ms: number, since?: Since): string {
	return (flash?.cells ?? [])
		.filter((cell) => since === undefined || age_of(cell, since.ms) < COOL_FRAMES)
		.map((cell) => cell_bytes(cell, now_ms))
		.join('')
}

function write(
	ports: Pick<BoardPorts, 'write_drawn'>,
	flash: Flash | undefined,
	now_ms: number,
	since?: Since,
): void {
	const overlay = bytes(flash, now_ms, since)

	if (overlay !== '') ports.write_drawn?.(overlay)
}

// Whether any cell is still flashing, so the spin keeps writing between redraws.
function is_lit(flash: Flash | undefined): boolean {
	return (flash?.cells.length ?? 0) > 0
}

const run_board_change_flash = { COOL_FRAMES, FRAME_MS, HEAD, BRIGHT, bytes, is_lit, next, write }

export { run_board_change_flash }
export type { Flash }
