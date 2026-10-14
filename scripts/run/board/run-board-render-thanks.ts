import { run_board_fit } from './run-board-fit'
import type { Link } from './run-board-link'
import type { Thanks } from './run-board-thanks-csv'

// The reviewers who helped kit, drawn above the legend as names alone — no label, no dimming. A name
// with a page opens it on Cmd+click through the same OSC 8 link the issue numbers use; one without
// is plain text. The names run on one line and wrap onto the next where the pane is too narrow,
// always between two names; a frame no terminal bounds draws them on one line.

const GAP = '  '
const INDENT = '  '

function named(thanker: Thanks[number], link: Link): string {
	return thanker.url === undefined ? thanker.name : link(thanker.name, thanker.url)
}

// The lines with `name` added to the last where it still fits, and on a line of its own where it does not.
function placed(lines: ReadonlyArray<string>, name: string, columns: number): Array<string> {
	const last = lines.at(-1)
	const joined = `${last ?? ''}${GAP}${name}`

	if (last !== undefined && run_board_fit.width_of(joined) <= columns) {
		return [...lines.slice(0, -1), joined]
	}

	return [...lines, `${INDENT}${name}`]
}

// The names packed into lines no wider than `columns`; a name wider than the pane alone takes a line.
function wrapped(names: ReadonlyArray<string>, columns: number): Array<string> {
	let lines: Array<string> = []

	for (const name of names) lines = placed(lines, name, columns)

	return lines
}

// The lines under a blank that parts them from what is above; none with no one to thank.
function thanks_lines(thanks: Thanks, link: Link, columns: number | undefined): Array<string> {
	if (thanks.length === 0) return []

	const names = thanks.map((thanker) => named(thanker, link))

	return ['', ...wrapped(names, columns ?? Infinity)]
}

const run_board_render_thanks = { thanks_lines }

export { run_board_render_thanks }
