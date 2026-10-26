import { describe, expect, it } from 'vitest'
import { pure_files_entries } from './pure-files-entries'

// joshuafolkken/kit#5001: rewriting one entry of `tools/test/pure-files.ts` ran the whole unit suite.

const KEPT = 'scripts/a/kept.test.ts'
const ADDED = 'scripts/b/added.test.ts'
const REMOVED = 'scripts/c/removed.test.ts'

function list_of(
	entries: ReadonlyArray<string>,
	head = 'const PURE_FILES: ReadonlyArray<string> = [',
): string {
	return [
		'// GENERATED FILE — do not edit by hand.',
		head,
		...entries.map((entry) => `\t'${entry}',`),
		']',
		'',
		'export { PURE_FILES }',
		'',
	].join('\n')
}

describe('pure_files_entries.moved_entries', () => {
	it('answers the entries added and removed when nothing else moved', () => {
		const moved = pure_files_entries.moved_entries(list_of([KEPT, REMOVED]), list_of([KEPT, ADDED]))

		expect(moved).toStrictEqual([ADDED, REMOVED])
	})

	it('answers no entry when the list was only reordered', () => {
		expect(
			pure_files_entries.moved_entries(list_of([KEPT, ADDED]), list_of([ADDED, KEPT])),
		).toStrictEqual([])
	})

	it('answers undefined when a line other than an entry moved', () => {
		const before = list_of([KEPT])
		const after = list_of([KEPT, ADDED], 'const PURE_FILES: Array<string> = [')

		expect(pure_files_entries.moved_entries(before, after)).toBeUndefined()
	})

	it('answers undefined when an import was added', () => {
		const after = `import { x } from './x'\n${list_of([KEPT])}`

		expect(pure_files_entries.moved_entries(list_of([KEPT]), after)).toBeUndefined()
	})

	it('ignores a missing trailing newline on either side', () => {
		expect(
			pure_files_entries.moved_entries(list_of([KEPT]).trimEnd(), list_of([KEPT])),
		).toStrictEqual([])
	})
})

describe('pure_files_entries.tests_of', () => {
	it('puts the list’s own tests ahead of the moved entries', () => {
		expect(pure_files_entries.tests_of([ADDED])).toStrictEqual([
			'tools/test/pure-files.test.ts',
			'tools/test/classify-isolation.test.ts',
			ADDED,
		])
	})
})

describe('pure_files_entries.read_moved', () => {
	it('answers undefined when the list is not among the changed files', async () => {
		await expect(pure_files_entries.read_moved('/repo', [KEPT])).resolves.toBeUndefined()
	})

	it('answers undefined when the change could not be read', async () => {
		await expect(pure_files_entries.read_moved('/repo', undefined)).resolves.toBeUndefined()
	})
})
