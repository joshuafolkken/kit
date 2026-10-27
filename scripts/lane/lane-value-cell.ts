// `josh lane:value cell --table <title> --row <label> --column <header>` — one cell of a table
// `josh lane:stats` prints, as one number (joshuafolkken/kit#5144). The tables are read as printed, so
// every new `lane:stats` table is declarable without a new metric and no aggregation is copied.
//
// A table is named by its first header cell and a row by its first cell. **The address must name one
// cell** — two tables share the `check` title, so an address that matches more than one numeric cell
// answers `undefined`, as a missing or non-numeric one does, never a guess.

const ROW_OPEN = '| '
const ROW_CLOSE = ' |'
const CELL_SEPARATOR = ' | '
const BLOCK_SEPARATOR = /\n\s*\n/u
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/u
const HEADER_ROWS = 2

interface CellAddress {
	table: string
	row: string
	column: string
}

type Cells = ReadonlyArray<string>

function cells_of(line: string): Cells | undefined {
	const text = line.trim()

	if (!text.startsWith(ROW_OPEN) || !text.endsWith(ROW_CLOSE)) return undefined

	return text.slice(ROW_OPEN.length, -ROW_CLOSE.length).split(CELL_SEPARATOR)
}

function rows_of(block: string): ReadonlyArray<Cells> {
	return block
		.split('\n')
		.map((line) => cells_of(line))
		.filter((row) => row !== undefined)
}

// Every printed table as its rows of cells, the header first; a block with no row is dropped.
function blocks_of(tables: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<Cells>> {
	return tables
		.flatMap((table) => table.split(BLOCK_SEPARATOR))
		.map((block) => rows_of(block))
		.filter((rows) => rows.length > 0)
}

// The cell texts at the address in one table — none when its title or column differs.
function texts_in(rows: ReadonlyArray<Cells>, address: CellAddress): ReadonlyArray<string> {
	const [header = []] = rows
	const column = header.indexOf(address.column)

	if (header[0] !== address.table || column < 1) return []

	return rows
		.slice(HEADER_ROWS)
		.filter((cells) => cells[0] === address.row)
		.map((cells) => cells[column] ?? '')
}

// The one numeric cell at `address` across `tables`, or `undefined` for none, many or a non-number.
function value(tables: ReadonlyArray<string>, address: CellAddress): number | undefined {
	const numbers = blocks_of(tables)
		.flatMap((rows) => texts_in(rows, address))
		.filter((text) => NUMBER_PATTERN.test(text))

	return numbers.length === 1 ? Number(numbers[0]) : undefined
}

const lane_value_cell = { value }

export type { CellAddress }
export { lane_value_cell }
