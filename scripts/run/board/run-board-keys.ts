import type { SectionKey } from './run-board-fit'
import { run_board_fold } from './run-board-fold'
import type { BoardStore, FoldStore } from './run-board-fold-store'
import type { CueName } from './run-board-sound-cues'

// The keys a live `run:board` reads: one per section, folding it or unfolding it (`run-board-fold.ts`),
// and `s`, flipping the sound on and off (joshuafolkken/kit#7953).
// The terminal is put in raw mode so a key arrives without Enter, which also stops it from turning
// Ctrl-C into SIGINT — so Ctrl-C is read as a key and quits, and leaving puts the terminal back.

const CTRL_C = '\u{3}'
const SWITCHED_ON_CUE: CueName = 'launch'

type Cue = (name: CueName) => void

// The keyboard as the board uses it; `interrupt` is what Ctrl-C does once raw mode reads it as a key,
// and `store` where the folds and the sound switch are kept across launches — none keeps them until
// the board closes.
interface KeyInput {
	is_tty: boolean
	raw: (is_raw: boolean) => void
	listen: (on_data: (chunk: string) => void) => void
	close: () => void
	interrupt: () => void
	store?: (FoldStore & Partial<BoardStore>) | undefined
}

// The sections folded so far, read at every redraw — none where no key can be read — and what puts the
// terminal back.
// `intercept` hands every key, Ctrl-C aside, to `on_key` instead of the folds, until the returned
// release is called.
// `sound` is the switch `s` flips, and `cue` the board's cue played only while it is on.
interface KeyReading {
	folded: (() => ReadonlySet<SectionKey>) | undefined
	stop?: (() => void) | undefined
	intercept?: ((on_key: () => void) => () => void) | undefined
	sound?: (() => boolean) | undefined
	cue?: Cue | undefined
}

// What a chunk of keys leaves folded, each key in the order typed.
function folded_by(folded: ReadonlySet<SectionKey>, chunk: string): ReadonlySet<SectionKey> {
	let next = folded

	for (const key of chunk) next = run_board_fold.toggled(next, key)

	return next
}

function same(left: ReadonlySet<SectionKey>, right: ReadonlySet<SectionKey>): boolean {
	return left.size === right.size && [...left].every((section) => right.has(section))
}

// A key saves only what it changed.
function folding(input: KeyInput): {
	fold: (chunk: string) => void
	folded: () => ReadonlySet<SectionKey>
} {
	let folded: ReadonlySet<SectionKey> = input.store?.load() ?? new Set()

	return {
		fold: (chunk) => {
			const next = folded_by(folded, chunk)
			if (!same(next, folded)) input.store?.save(next)
			folded = next
		},
		folded: () => folded,
	}
}

// The sound switch, on as the store last left it, saved on every flip; switching it on plays the launch
// cue once, so a person hears at once that it works.
function sounding(
	input: KeyInput,
	cue: Cue | undefined,
): { flip: () => void; sound: () => boolean } {
	let is_on = input.store?.load_sound?.() ?? true

	return {
		flip: () => {
			is_on = !is_on
			input.store?.save_sound?.(is_on)
			if (is_on) cue?.(SWITCHED_ON_CUE)
		},
		sound: () => is_on,
	}
}

// Each key in the chunk: `s` flips the sound, every other key goes to the folds.
function pressing(
	input: KeyInput,
	cue: Cue | undefined,
): Omit<KeyReading, 'intercept' | 'stop'> & {
	press: (chunk: string) => void
} {
	const { fold, folded } = folding(input)
	const { flip, sound } = sounding(input, cue)

	return {
		folded,
		sound,
		cue: (name) => {
			if (sound()) cue?.(name)
		},
		press: (chunk) => {
			fold(chunk)
			for (const key of chunk) if (key === run_board_fold.SOUND_KEY) flip()
		},
	}
}

function read_keys(input: KeyInput | undefined, cue?: Cue): KeyReading {
	if (input?.is_tty !== true) return { folded: undefined }

	const { press, ...reading } = pressing(input, cue)
	const held: { taker: (() => void) | undefined } = { taker: undefined }

	input.raw(true)
	input.listen((chunk) => {
		if (chunk.includes(CTRL_C)) input.interrupt()
		else if (held.taker === undefined) press(chunk)
		else held.taker()
	})

	return {
		...reading,
		stop: () => {
			input.raw(false)
			input.close()
		},
		intercept: (on_key) => {
			held.taker = on_key

			return () => {
				held.taker = undefined
			}
		},
	}
}

const run_board_keys = { CTRL_C, read_keys }

export { run_board_keys }
export type { KeyInput, KeyReading }
