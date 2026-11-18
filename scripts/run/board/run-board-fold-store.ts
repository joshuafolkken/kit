import { readFileSync } from 'node:fs'
import { atomic_write } from '#scripts/lib/atomic-write'
import { usage_state_path } from '#scripts/usage/usage-state-path'
import type { SectionKey } from './run-board-fit'
import { run_board_fold } from './run-board-fold'

// The sections a person folded on a live `run:board`, kept across launches (joshuafolkken/kit#7213):
// one account-wide file, `{ "folded": [<section name>…] }`, written on every fold so Ctrl-C or a kill
// loses nothing. Several boards open at once leave the last one folded. A file that is missing, broken
// or names a section this board does not know restores what it can — none of it, the unknown names
// dropped — and a write that fails leaves the board drawing.
// The same file keeps the sound cue switch as `"sound": true|false` (joshuafolkken/kit#7950), on unless
// the file says a boolean otherwise. Each save rewrites only its own field and keeps the other.

interface FoldStore {
	load: () => ReadonlySet<SectionKey>
	save: (folded: ReadonlySet<SectionKey>) => void
}

interface BoardStore extends FoldStore {
	load_sound: () => boolean
	save_sound: (is_on: boolean) => void
}

function parsed(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return undefined
	}
}

function fields(file: string): Readonly<Record<string, unknown>> {
	const value = parsed(file)

	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

	return { ...value }
}

function folded_names(file: string): ReadonlyArray<unknown> {
	const { folded } = fields(file)

	return Array.isArray(folded) ? folded : []
}

function known(name: unknown): SectionKey | undefined {
	return run_board_fold.SECTIONS.find((section) => section === name)
}

function load(file: string): ReadonlySet<SectionKey> {
	const sections = folded_names(file).map((name) => known(name))

	return new Set(sections.filter((section) => section !== undefined))
}

function load_sound(file: string): boolean {
	const { sound } = fields(file)

	return typeof sound !== 'boolean' || sound
}

function save_field(file: string, field: Readonly<Record<string, unknown>>): void {
	try {
		atomic_write.replace_file(file, `${JSON.stringify({ ...fields(file), ...field })}\n`)
	} catch {
		// The board keeps drawing; the setting is lost at the next launch only.
	}
}

function file_store(file = usage_state_path.board()): BoardStore {
	return {
		load: () => load(file),
		save: (folded) => {
			save_field(file, { folded: [...folded] })
		},
		load_sound: () => load_sound(file),
		save_sound: (is_on) => {
			save_field(file, { sound: is_on })
		},
	}
}

const run_board_fold_store = { file_store }

export { run_board_fold_store }
export type { BoardStore, FoldStore }
