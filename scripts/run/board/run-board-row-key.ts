// joshuafolkken/kit#8003: the key of an issue row — its section and number — carried from where the row
// is drawn (`run-board-render-row.ts`) to where its place on screen is recorded (`run-board-spin.ts`).
// It leads the row's text between private-use characters no terminal draws, which the fit counts as no
// columns and the spin takes out before the frame is written.

const OPEN = '\u{E001}'
const CLOSE = '\u{E002}'

// The sections whose rows a theme types as they appear (`run-board-type-rows.ts`), and the header's
// now line (joshuafolkken/kit#8103), keyed by its text rather than a number, and a queued epic's 📁 line
// (joshuafolkken/kit#8115), keyed by the epic's number, and an empty seat's 💺 line
// (joshuafolkken/kit#8116), keyed by its reason, and a findings / notes line (joshuafolkken/kit#8117),
// keyed by the event it came from.
type KeySection =
	'lanes' | 'decision' | 'queued' | 'waiting' | 'done' | 'now' | 'epic' | 'seat' | 'note'

// A line's key, the line without it, and the part of the line before the key — drawn whole, never typed.
interface Split {
	key: string | undefined
	text: string
	prefix: string
}

// The key of the row `id` names in `section`: an issue row's number, the now line's text.
function key_of(section: KeySection, id: number | string): string {
	return `${section}:${String(id)}`
}

// `text` led by the key of the row it draws; no key where the row's section names none. A line whose
// key follows a prefix types only from the key on.
function keyed(section: KeySection | undefined, id: number | string, text: string): string {
	if (section === undefined) return text

	return `${OPEN}${key_of(section, id)}${CLOSE}${text}`
}

function split_key(line: string): Split {
	const open = line.indexOf(OPEN)
	const close = line.indexOf(CLOSE, open)

	if (open === -1 || close === -1) return { key: undefined, text: line, prefix: '' }

	const prefix = line.slice(0, open)

	return {
		key: line.slice(open + OPEN.length, close),
		text: `${prefix}${line.slice(close + CLOSE.length)}`,
		prefix,
	}
}

function without_key(line: string): string {
	return split_key(line).text
}

const run_board_row_key = { key_of, keyed, split_key, without_key }

export { run_board_row_key }
export type { KeySection }
