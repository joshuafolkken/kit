// joshuafolkken/kit#8003: the key of an issue row — its section and number — carried from where the row
// is drawn (`run-board-render-row.ts`) to where its place on screen is recorded (`run-board-spin.ts`).
// It leads the row's text between private-use characters no terminal draws, which the fit counts as no
// columns and the spin takes out before the frame is written.

const OPEN = '\u{E001}'
const CLOSE = '\u{E002}'

// The sections whose rows a theme types as they appear (`run-board-type-rows.ts`).
type KeySection = 'lanes' | 'decision' | 'queued' | 'waiting' | 'done'

interface Split {
	key: string | undefined
	text: string
}

// `text` led by the key of the row it draws; no key where the row's section names none.
function keyed(section: KeySection | undefined, number: number, text: string): string {
	if (section === undefined) return text

	return `${OPEN}${section}:${String(number)}${CLOSE}${text}`
}

// A line's key and the line without it.
function split_key(line: string): Split {
	const open = line.indexOf(OPEN)
	const close = line.indexOf(CLOSE, open)

	if (open === -1 || close === -1) return { key: undefined, text: line }

	return {
		key: line.slice(open + OPEN.length, close),
		text: `${line.slice(0, open)}${line.slice(close + CLOSE.length)}`,
	}
}

function without_key(line: string): string {
	return split_key(line).text
}

const run_board_row_key = { keyed, split_key, without_key }

export { run_board_row_key }
export type { KeySection }
