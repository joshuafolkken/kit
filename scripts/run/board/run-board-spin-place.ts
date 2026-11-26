import { run_board_fit } from './run-board-fit'
import { run_board_row_key } from './run-board-row-key'
import { run_board_spot, type Spot } from './run-board-spot'
import type { KeyedLine } from './run-board-type-rows'

// Where a live `run:board` frame's placeholders land on screen (`run-board-spin.ts`): the row each line
// starts on after the lines above it wrap, each placeholder's spot and the keyed rows.

const { spot_at } = run_board_spot

interface ScreenBounds {
	rows: number
	columns: number
}

// The frame's lines with their placeholders drawn and keys taken out, and its keyed rows.
interface Keyed {
	lines: Array<string>
	keyed: Array<KeyedLine>
}

// Each `mark` placeholder's spot in `lines`, on screen.
function marks_in(
	lines: ReadonlyArray<string>,
	mark: string,
	starts: ReadonlyArray<number>,
	size: ScreenBounds,
): Array<Spot> {
	return lines
		.flatMap((line, index) =>
			[...line.matchAll(new RegExp(mark, 'gu'))].map((match) =>
				spot_at(line, match.index, starts[index] ?? 1, size.columns),
			),
		)
		.filter((spot) => spot.row <= size.rows)
}

// The row on screen each line starts on, after the lines above it wrap.
function starts_of(lines: ReadonlyArray<string>, columns: number): Array<number> {
	let row = 1

	return lines.map((line) => {
		const start = row

		row += run_board_fit.height_of(line, columns)

		return start
	})
}

// The keyed row of a split line at `index`, on screen `row`; none for a line with no key. What follows
// its end mark (joshuafolkken/kit#8607) rides along, drawn whole after the typed text.
function keyed_line(
	{ key, text, prefix, suffix }: ReturnType<typeof run_board_row_key.split_key>,
	index: number,
	row: number,
): Array<KeyedLine> {
	if (key === undefined) return []

	const line = { key, index, row, text, prefix_columns: run_board_fit.width_of(prefix) }

	return [suffix === '' ? line : { ...line, suffix }]
}

// Each line with its placeholders drawn as `frame` and its key taken out, and the keyed ones — their
// placeholders kept, so a typing row draws the spinner's frame of the moment it is written.
function keyed_of(
	lines: ReadonlyArray<string>,
	frame: string,
	starts: ReadonlyArray<number>,
): Keyed {
	const split = lines.map((line) => run_board_row_key.split_key(line))
	const keyed = split.flatMap((line, index) => keyed_line(line, index, starts[index] ?? 1))

	return {
		lines: split.map((line) => run_board_spot.drawn(`${line.text}${line.suffix}`, frame)),
		keyed,
	}
}

// A keyed row types only on screen and within one screen row: a row typed shorter than it wraps would
// take fewer rows and move every line below it off the spots recorded for them.
function can_type(line: KeyedLine, rows: number, columns: number): boolean {
	return (
		line.row <= rows && run_board_fit.height_of(`${line.text}${line.suffix ?? ''}`, columns) === 1
	)
}

const run_board_spin_place = { can_type, keyed_of, marks_in, starts_of }

export { run_board_spin_place }
