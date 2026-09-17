import { describe, expect, it } from 'vitest'
import { top_level_scripts_guard } from './top-level-scripts-guard'

// The judgment — "which top-level names are offenders" — is verified over plain listings so a
// regression is pinned without depending on the tree, and the structural case below then applies the
// same judgment to the real `scripts/` directory.
describe('top_level_scripts_guard.top_level_offenders', () => {
	const empty = new Set<string>()

	it('flags a top-level .ts file that is not allowlisted', () => {
		expect(top_level_scripts_guard.top_level_offenders(['stray.ts'], empty)).toStrictEqual([
			'stray.ts',
		])
	})

	it('flags a top-level .sh file', () => {
		expect(top_level_scripts_guard.top_level_offenders(['run.sh'], empty)).toStrictEqual(['run.sh'])
	})

	it('ignores names whose extension is not guarded', () => {
		expect(
			top_level_scripts_guard.top_level_offenders(['notes.md', 'data.json'], empty),
		).toStrictEqual([])
	})

	it('exempts an allowlisted name', () => {
		expect(
			top_level_scripts_guard.top_level_offenders(['keep.ts'], new Set(['keep.ts'])),
		).toStrictEqual([])
	})
})

// The guard itself: no `.ts` / `.sh` file may sit directly under `scripts/` unless the allowlist
// names it. A new flat file fails here (joshuafolkken/kit#2013).
describe('scripts/ layout — no un-allowlisted top-level files', () => {
	it('keeps every script in a domain subdirectory', () => {
		const offenders = top_level_scripts_guard.top_level_offenders(
			top_level_scripts_guard.read_top_level_entries(),
		)

		expect(offenders).toStrictEqual([])
	})
})
