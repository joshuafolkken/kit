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

interface FoldStore {
	load: () => ReadonlySet<SectionKey>
	save: (folded: ReadonlySet<SectionKey>) => void
}

function parsed(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, 'utf8'))
	} catch {
		return undefined
	}
}

function folded_names(value: unknown): ReadonlyArray<unknown> {
	if (typeof value !== 'object' || value === null || !('folded' in value)) return []

	return Array.isArray(value.folded) ? value.folded : []
}

function known(name: unknown): SectionKey | undefined {
	return run_board_fold.SECTIONS.find((section) => section === name)
}

function load(file: string): ReadonlySet<SectionKey> {
	const sections = folded_names(parsed(file)).map((name) => known(name))

	return new Set(sections.filter((section) => section !== undefined))
}

function save(file: string, folded: ReadonlySet<SectionKey>): void {
	try {
		atomic_write.replace_file(file, `${JSON.stringify({ folded: [...folded] })}\n`)
	} catch {
		// The board keeps drawing; the fold is lost at the next launch only.
	}
}

function file_store(file = usage_state_path.board()): FoldStore {
	return {
		load: () => load(file),
		save: (folded) => {
			save(file, folded)
		},
	}
}

const run_board_fold_store = { file_store }

export { run_board_fold_store }
export type { FoldStore }
