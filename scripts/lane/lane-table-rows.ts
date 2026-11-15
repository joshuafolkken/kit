// A per-lane table's rows capped for `josh lane:stats`' default output (joshuafolkken/kit#7578): a
// period of hundreds of lanes printed every row and overflowed a session's output cap. The rows past
// the cap become one note; `--all` prints every row, and `josh lane:value cell` always reads them all.

interface TableOptions {
	// `--all`: every row, no note.
	is_all: boolean
}

const ALL_ROWS: TableOptions = { is_all: true }

function omitted_note(omitted: number): string {
	return `… ${String(omitted)} more rows omitted — \`--all\` prints every row`
}

// The first `cap` of `rows`, in their order, and a note naming how many were left out.
function capped(rows: ReadonlyArray<string>, cap: number, options: TableOptions): Array<string> {
	if (options.is_all || rows.length <= cap) return [...rows]

	return [...rows.slice(0, cap), '', omitted_note(rows.length - cap)]
}

const lane_table_rows = { ALL_ROWS, capped }

export { lane_table_rows }
export type { TableOptions }
