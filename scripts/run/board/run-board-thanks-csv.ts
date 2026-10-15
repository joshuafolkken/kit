import { parse } from 'csv-parse/sync'
import { run_board_render_title } from './run-board-render-title'

// The reviewers who helped kit, read off the published roster's CSV. The roster is a spreadsheet anyone
// with edit access changes, so nothing in it is trusted as drawn: a sheet whose header is not `name,url`
// is not the roster, a row without a name or with a link that is not `https://` is dropped, and a name
// loses every control character — an escape in a cell would otherwise be written to the terminal as one.

const HEADER = ['name', 'url'] as const
// Enough for any person's or project's name, short enough that one cell cannot fill the line; a
// longer one is cut to an ellipsis, as a row's title is.
const NAME_LIMIT = 40
const CONTROL = /\p{Cc}/gu
const SAFE_URL = /^https:\/\/[^\s\p{Cc}]+$/u

interface Thanker {
	name: string
	// The page the name opens; `undefined` draws the name unlinked.
	url: string | undefined
}

type Thanks = ReadonlyArray<Thanker>

function name_of(cell: string): string {
	return run_board_render_title.title_of(cell.replaceAll(CONTROL, '').trim(), NAME_LIMIT)
}

// An empty cell is a name without a link; any other value has to be a whole `https://` URL.
function url_of(cell: string): string | undefined | false {
	const url = cell.trim()

	if (url === '') return undefined

	return SAFE_URL.test(url) && URL.canParse(url) ? url : false
}

function thanker_of(row: ReadonlyArray<string>): Array<Thanker> {
	const [name_cell = '', url_cell = ''] = row
	const name = name_of(name_cell)
	const url = url_of(url_cell)

	if (name === '' || url === false) return []

	return [{ name, url }]
}

function is_roster(header: ReadonlyArray<string> | undefined): boolean {
	return header?.length === HEADER.length && HEADER.every((cell, index) => header[index] === cell)
}

function rows_of(csv: string): Array<Array<string>> | undefined {
	try {
		return parse(csv, { relax_column_count: true, skip_empty_lines: true, bom: true })
	} catch {
		return undefined
	}
}

// `undefined` for a text that is not the roster, so a failed read is told apart from an empty roster.
function thanks_of(csv: string): Thanks | undefined {
	const [header, ...rows] = rows_of(csv) ?? []

	if (!is_roster(header)) return undefined

	return rows.flatMap((row) => thanker_of(row))
}

const run_board_thanks_csv = { NAME_LIMIT, thanks_of }

export { run_board_thanks_csv }
export type { Thanker, Thanks }
