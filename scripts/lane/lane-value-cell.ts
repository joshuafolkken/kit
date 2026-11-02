// `josh lane:value cell --table <title> --row <label> --column <header>` — one cell of a table
// `josh lane:stats` prints, as one number (joshuafolkken/kit#5144). The tables are read as printed, so
// every new `lane:stats` table is declarable without a new metric and no aggregation is copied.
//
// A table is named by its first header cell and a row by its first cell; `where` narrows the rows by
// another column, for a table whose first cell repeats or is itself a count (joshuafolkken/kit#5947).
// `item` reads one count out of a `label N, label N` list cell, `0` when the list omits it. **The
// address must name one cell** — two tables share the `check` title, so an address that matches more
// than one numeric cell answers `undefined`, as a missing or non-numeric one does, never a guess.

const ROW_OPEN = '| '
const ROW_CLOSE = ' |'
const CELL_SEPARATOR = ' | '
const BLOCK_SEPARATOR = /\n\s*\n/u
const NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/u
const HEADER_ROWS = 2
// A list cell as `lane-stop-stats.ts` prints its causes: `label N` pairs joined by `, `, `-` for none.
const LIST_SEPARATOR = ', '
const EMPTY_LIST = '-'
const ITEM_PATTERN = /^(?<label>.+) (?<count>\d+)$/u
const ABSENT_COUNT = '0'

interface CellFilter {
	column: string
	text: string
}

interface CellAddress {
	table: string
	column: string
	row?: string | undefined
	where?: CellFilter | undefined
	item?: string | undefined
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

// A row the address keeps: its first cell is `row` when one is named, its `where` column holds `text`.
function is_addressed(cells: Cells, header: Cells, address: CellAddress): boolean {
	const { row, where } = address

	if (row !== undefined && cells[0] !== row) return false

	return where === undefined || cells[header.indexOf(where.column)] === where.text
}

// The cell texts at the address in one table — none when its title or column differs.
function texts_in(rows: ReadonlyArray<Cells>, address: CellAddress): ReadonlyArray<string> {
	const [header = []] = rows
	const column = header.indexOf(address.column)

	if (column === -1 || header[0] !== address.table) return []

	return rows
		.slice(HEADER_ROWS)
		.filter((cells) => is_addressed(cells, header, address))
		.map((cells) => cells[column] ?? '')
}

// `item`'s count in a list cell, `0` for a list without it, `undefined` for a cell that is no list.
function item_count(text: string, item: string): string | undefined {
	if (text === EMPTY_LIST) return ABSENT_COUNT

	const entries = text.split(LIST_SEPARATOR).map((entry) => ITEM_PATTERN.exec(entry)?.groups)

	if (entries.includes(undefined)) return undefined

	return entries.find((groups) => groups?.['label'] === item)?.['count'] ?? ABSENT_COUNT
}

function read_text(text: string, item: string | undefined): string | undefined {
	return item === undefined ? text : item_count(text, item)
}

// The one numeric cell at `address` across `tables`, or `undefined` for none, many or a non-number.
function value(tables: ReadonlyArray<string>, address: CellAddress): number | undefined {
	const numbers = blocks_of(tables)
		.flatMap((rows) => texts_in(rows, address))
		.map((text) => read_text(text, address.item))
		.filter((text) => text !== undefined && NUMBER_PATTERN.test(text))

	return numbers.length === 1 ? Number(numbers[0]) : undefined
}

const lane_value_cell = { value }

export type { CellAddress, CellFilter }
export { lane_value_cell }
