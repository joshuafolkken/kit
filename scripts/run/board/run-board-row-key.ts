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
// keyed by the event it came from, and the header's last notice (joshuafolkken/kit#8114), keyed by its
// words, after the sound switch drawn whole, and the header's progress line from its first figure the
// plan knows (joshuafolkken/kit#8457), after the run's age drawn whole.
type KeySection =
	| 'lanes'
	| 'decision'
	| 'queued'
	| 'waiting'
	| 'done'
	| 'now'
	| 'epic'
	| 'seat'
	| 'note'
	| 'notice'
	| 'plan'

// joshuafolkken/kit#8607: a keyed line's end mark — what follows it (the watch panel beside the header)
// is drawn whole in its own columns, never typed with the row.
// `run-board-spot.ts` holds E000 and E003–E007.
const END = '\u{E008}'

// A line's key, the line without it (up to its end mark), the part of the line before the key and the
// part after its end mark — both drawn whole, never typed.
interface Split {
	key: string | undefined
	text: string
	prefix: string
	suffix: string
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
	const [body = '', ...rest] = line.split(END)
	const suffix = rest.join('')
	const open = body.indexOf(OPEN)
	const close = body.indexOf(CLOSE, open)

	if (open === -1 || close === -1) return { key: undefined, text: body, prefix: '', suffix }

	const prefix = body.slice(0, open)

	return {
		key: body.slice(open + OPEN.length, close),
		text: `${prefix}${body.slice(close + CLOSE.length)}`,
		prefix,
		suffix,
	}
}

function without_key(line: string): string {
	const { text, suffix } = split_key(line)

	return `${text}${suffix}`
}

// `line` redrawn as `drawn` — its key-free text, cut or padded — with `suffix` after its end mark, its
// key kept where it was; a line with no key takes `suffix` straight after.
function rekeyed(line: string, drawn: string, suffix: string): string {
	const { key, prefix } = split_key(line)

	if (key === undefined) return `${drawn}${suffix}`

	return `${prefix}${OPEN}${key}${CLOSE}${drawn.slice(prefix.length)}${END}${suffix}`
}

const run_board_row_key = { key_of, keyed, rekeyed, split_key, without_key }

export { run_board_row_key }
export type { KeySection }
