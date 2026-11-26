import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_hash } from './run-board-theme-host-hash'
import type { Grid } from './run-board-theme-host-types'
import { run_board_theme_skynet_data } from './run-board-theme-skynet-data'

// The TERMINATOR theme's listings (joshuafolkken/kit#8917), ported from the confirmed theme demo:
// the machine's assembly listing, a SCAN line every ninth, racing in columns and along a ticker.

const { pick, put } = run_board_theme_host_grid
const { hash } = run_board_theme_host_hash
const { INKS, LINE, MNEMONICS } = run_board_theme_skynet_data

const TICKER_LINES = 8
const HEX = 16

// One listing column: `rows` lines from line `from`, the newest bright while it races.
interface ListingColumn {
	x: number
	width: number
	rows: ReadonlyArray<number>
	from: number
	salt: number
	is_racing: boolean
}

function hex(value: number, width: number): string {
	return value.toString(HEX).toUpperCase().padStart(width, '0')
}

function scan_line(line: number, salt: number): string {
	const match = (LINE.match_from + hash(line, salt) * LINE.match_span).toFixed(1)

	return `SCAN ${hex((line * LINE.scan_step + salt) % LINE.word, LINE.wide)}  MATCH ${match}%`
}

function operand_of(line: number, salt: number): string {
	if (hash(line, salt, LINE.operand_salt) < LINE.half) {
		return `#$${hex(Math.floor(hash(line, salt, LINE.byte_salt) * LINE.byte), LINE.narrow)}`
	}

	return `$${hex(Math.floor(hash(line, salt, LINE.word_salt) * LINE.word), LINE.wide)}`
}

function listing_line(line: number, salt: number = LINE.salt): string {
	if (line % LINE.scan_every === 0) return scan_line(line, salt)
	const address = hex((LINE.base + line * LINE.step + salt * LINE.byte) % LINE.word, LINE.wide)
	const mnemonic = pick(MNEMONICS, hash(line, salt, LINE.pick_salt))

	return `${address}   ${mnemonic} ${operand_of(line, salt)}`
}

function line_style(line: number, is_newest: boolean): string {
	if (is_newest) return INKS.INK

	return line % LINE.scan_every === 0 ? INKS.SCAN_MARK : INKS.PINK
}

function listing_column(grid: Grid, column: ListingColumn): void {
	const { x, width, rows, from, salt, is_racing } = column

	for (const [index, y] of rows.entries()) {
		const line = from + index
		const text = listing_line(line, salt).padEnd(width).slice(0, width)

		put(grid, { y, x }, text, line_style(line, index === rows.length - 1 && is_racing))
	}
}

// Listings racing side by side: column k starts on line `step * (k + 1) + offset`, salted
// `salt + k * salt_step`.
interface Race {
	columns: ReadonlyArray<number>
	width: number
	rows: ReadonlyArray<number>
	step: number
	offset: number
	salt: number
	salt_step: number
	is_racing: boolean
}

function race_columns(grid: Grid, race: Race): void {
	for (const [index, x] of race.columns.entries()) {
		listing_column(grid, {
			x,
			width: race.width,
			rows: race.rows,
			from: race.step * (index + 1) + race.offset,
			salt: race.salt + index * race.salt_step,
			is_racing: race.is_racing,
		})
	}
}

function ticker_text(from: number): string {
	return Array.from({ length: TICKER_LINES }, (_, index) =>
		listing_line(from + index).replaceAll(/\s+/gu, ' '),
	).join(' · ')
}

const run_board_theme_skynet_listing = {
	hex,
	listing_column,
	listing_line,
	race_columns,
	ticker_text,
}

export { run_board_theme_skynet_listing }
export type { ListingColumn, Race }
