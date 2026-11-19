import { run_board_fit } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import type { Link } from './run-board-link'
import type { Thanks } from './run-board-thanks-csv'

// The reviewers who helped kit, drawn above the legend as names led by one 🙏 — no label, no dimming. A name
// with a page opens it on Cmd+click through the same OSC 8 link the issue numbers use; one without
// is plain text. The names run on one line and wrap onto the next where the pane is too narrow,
// always between two names; a frame no terminal bounds draws them on one line.

const GAP = '  '
const INDENT = '  '
const MARK = '🙏 '
// A name the roster leads with an icon, `📦 What's new`: the icon beside its label (joshuafolkken/kit#8154).
const ICON_LED = /^(\p{Extended_Pictographic}\u{FE0F}?) (.+)$/u

function labeled(name: string): string {
	const [, icon, word] = ICON_LED.exec(name) ?? []

	return icon === undefined || word === undefined ? name : run_board_label_pair.pair(icon, word)
}

function named(thanker: Thanks[number], link: Link): string {
	const name = labeled(thanker.name)

	return thanker.url === undefined ? name : link(name, thanker.url)
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

	const [first = '', ...rest] = thanks.map((thanker) => named(thanker, link))

	return ['', ...wrapped([`${MARK}${first}`, ...rest], columns ?? Infinity)]
}

const run_board_render_thanks = { thanks_lines }

export { run_board_render_thanks }
