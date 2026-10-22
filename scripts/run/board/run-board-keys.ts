import type { SectionKey } from './run-board-fit'
import { run_board_fold } from './run-board-fold'

// The keys a live `run:board` reads: one per section, folding it or unfolding it (`run-board-fold.ts`).
// The terminal is put in raw mode so a key arrives without Enter, which also stops it from turning
// Ctrl-C into SIGINT — so Ctrl-C is read as a key and quits, and leaving puts the terminal back.

const CTRL_C = '\u{3}'

// The keyboard as the board uses it; `interrupt` is what Ctrl-C does once raw mode reads it as a key.
interface KeyInput {
	is_tty: boolean
	raw: (is_raw: boolean) => void
	listen: (on_data: (chunk: string) => void) => void
	close: () => void
	interrupt: () => void
}

// The sections folded so far, read at every redraw — none where no key can be read — and what puts the
// terminal back.
interface KeyReading {
	folded: (() => ReadonlySet<SectionKey>) | undefined
	stop?: (() => void) | undefined
}

// What a chunk of keys leaves folded, each key in the order typed.
function folded_by(folded: ReadonlySet<SectionKey>, chunk: string): ReadonlySet<SectionKey> {
	let next = folded

	for (const key of chunk) next = run_board_fold.toggled(next, key)

	return next
}

function read_keys(input: KeyInput | undefined): KeyReading {
	if (input?.is_tty !== true) return { folded: undefined }

	let folded: ReadonlySet<SectionKey> = new Set()

	input.raw(true)
	input.listen((chunk) => {
		if (chunk.includes(CTRL_C)) input.interrupt()
		else folded = folded_by(folded, chunk)
	})

	return {
		folded: () => folded,
		stop: () => {
			input.raw(false)
			input.close()
		},
	}
}

const run_board_keys = { CTRL_C, read_keys }

export { run_board_keys }
export type { KeyInput, KeyReading }
