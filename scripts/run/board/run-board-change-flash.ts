import { WriteStream } from 'node:tty'
import { run_board_cut_styled } from './run-board-cut-styled'
import { run_board_deja_vu, type DejaVu } from './run-board-deja-vu'
import { run_board_frame_diff, type ChangedCell } from './run-board-frame-diff'
import { run_board_labels } from './run-board-labels'
import type { BoardPorts } from './run-board-state'
import type { KeyedLine } from './run-board-type-rows'

const { CSI, HEAD } = run_board_frame_diff
// The flash counts its own ticks, apart from the spinner's frames deja vu keeps counting.
const TICK_MS = 50
// HEAD and a decoded katakana for the first ticks, then a CRT afterglow: the gap to the cell's own
// color shrinks by `FADE_RATE` a tick until `FADE_TICKS`, where the cell's own style is written back.
const DECODE_TICKS = 2
const FADE_TICKS = 19
const FADE_RATE = 0.78
// Half-width katakana: one UTF-16 unit and one column each.
const KATAKANA = 'ｦｱｳｴｵｶｷｹｺｻ'
// The one-column characters a katakana stands in for, so a decoded cell moves no column.
const DECODED = /^[!-~]$/u
// The body color a cell with no 24-bit color of its own fades to.
const BODY_RGB = '0;215;60'
const RGB_PATTERN = /38;2;(\d+);(\d+);(\d+)m/gu
// Below 24-bit color: the palette's `whiteBright` for HEAD, `greenBright` for the afterglow.
const NAMED_HEAD = `${CSI}97m`
const NAMED_FADE = `${CSI}92m`

interface FlashCell extends ChangedCell {
	start_ms: number
}

// The changed glyphs and, under them, the rows replaying an event (`run-board-deja-vu.ts`).
interface Flash {
	lines: ReadonlyArray<KeyedLine>
	cells: ReadonlyArray<FlashCell>
	deja_vu: ReadonlyArray<DejaVu>
}

function tick_of(ms: number): number {
	return Math.floor(ms / TICK_MS)
}

function age_of(cell: FlashCell, now_ms: number): number {
	return tick_of(now_ms) - tick_of(cell.start_ms)
}

// The last 24-bit foreground color a style sets, else the body color.
function rgb_of(style: string): Array<number> {
	const found = [...style.matchAll(RGB_PATTERN)].at(-1)

	return (found?.slice(1) ?? BODY_RGB.split(';')).map(Number)
}

const HEAD_RGB = rgb_of(HEAD)

// `own + (HEAD − own) × FADE_RATE^(age − 1)` a channel, rounded: HEAD through age 1.
function fade_rgb(own: ReadonlyArray<number>, age: number): string {
	const kept = FADE_RATE ** Math.max(0, age - 1)

	return own
		.map((channel, index) => Math.round(channel + ((HEAD_RGB[index] ?? channel) - channel) * kept))
		.join(';')
}

// The flash color at `age`, in 24-bit color where stdout draws it, else the palette's.
function paint(cell: FlashCell, age: number): string {
	const is_head = age < DECODE_TICKS

	if (WriteStream.prototype.getColorDepth() < run_board_labels.RGB_COLOR_DEPTH) {
		return is_head ? NAMED_HEAD : NAMED_FADE
	}

	return `${CSI}38;2;${fade_rgb(rgb_of(cell.style), age)}m`
}

// The first ticks show a katakana in place of the new character; a blank stays blank.
function glyph_of(cell: FlashCell, age: number, now_ms: number): string {
	if (age >= DECODE_TICKS || !DECODED.test(cell.text)) return cell.text

	return KATAKANA.charAt((tick_of(now_ms) + cell.column) % KATAKANA.length)
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
		.filter((cell) => !renewed.has(identity(cell)) && age_of(cell, now_ms) < FADE_TICKS)
		.flatMap((cell) => refreshed(cell, lines))

	return {
		lines,
		cells: [...kept, ...changes.map((cell) => ({ ...cell, start_ms: now_ms }))],
		deja_vu: run_board_deja_vu.next(last, lines, now_ms),
	}
}

function cell_bytes(cell: FlashCell, now_ms: number): string {
	const age = age_of(cell, now_ms)
	const lit = age < FADE_TICKS ? `${paint(cell, age)}${glyph_of(cell, age, now_ms)}` : cell.text

	const glyph = run_board_cut_styled.cut_styled(`${cell.style}${lit}`, Infinity)

	return `${CSI}${String(cell.row)};${String(cell.column)}H${glyph}`
}

// The moment the last write between redraws was made at, none before the first.
interface Since {
	ms: number
}

// The expiration tick rewrites the original styled glyph once, then leaves it alone. A replayed row
// is written first, so a glyph flashing on it draws over its restored text.
function bytes(flash: Flash | undefined, now_ms: number, since?: Since): string {
	if (flash === undefined) return ''
	const cells = flash.cells
		.filter((cell) => since === undefined || age_of(cell, since.ms) < FADE_TICKS)
		.map((cell) => cell_bytes(cell, now_ms))
		.join('')

	return `${run_board_deja_vu.bytes(flash, now_ms, since)}${cells}`
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

// Whether any cell is still flashing or any row replaying, so the spin keeps writing between redraws.
function is_lit(flash: Flash | undefined): boolean {
	return (flash?.cells.length ?? 0) + (flash?.deja_vu.length ?? 0) > 0
}

// The next tick a flashing cell's color steps on, none while no cell flashes; a replaying row keeps
// the spinner's frames, which the spin wakes on anyway.
function wake_after(flash: Flash | undefined, now_ms: number): number {
	if ((flash?.cells.length ?? 0) === 0) return Infinity

	return (tick_of(now_ms) + 1) * TICK_MS
}

const run_board_change_flash = { FADE_TICKS, HEAD, TICK_MS, bytes, is_lit, next, wake_after, write }

export { run_board_change_flash }
export type { Flash }
