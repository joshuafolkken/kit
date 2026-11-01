import { readdirSync } from 'node:fs'
import path from 'node:path'
import { test_related_pins } from './test-related-pins'
import { related_scope, type RelatedScope } from './test-related-scope'

// `josh test:related --touched` — the implementation loop's re-check (joshuafolkken/kit#5237). A change
// near a hub reaches hundreds of test files, and paying that reach after every small edit repeats it
// minutes apart. **The touched scope reads no test-read map and no import graph**: it is the diff's own
// test files and, for each changed module `foo.ts`, its colocated `foo.test.ts` and `foo.*.test.ts`,
// plus the tests the change pins (`test-related-pins.ts`).
// What an edit breaks further away is the full-reach run's to find, so a touched run leaves no green
// record (`scoped-green.ts`) and is recorded in the lane ledger under its own kind.

const TOUCHED_FLAG = '--touched'
const TOUCHED_KIND = 'touched'
const TEST_SUFFIX = '.test.ts'
const TOUCHED_REASON =
	'the diff test files, the tests named after its modules and the tests it pins'
const NOTHING_TOUCHED_REASON = 'no test file is in the diff or named after a changed module'

type ListDirectory = (directory: string) => ReadonlyArray<string>

// A directory that cannot be listed holds no test to run.
function list_directory(directory: string): ReadonlyArray<string> {
	try {
		return readdirSync(directory)
	} catch {
		return []
	}
}

function is_named_after(module_file: string, name: string): boolean {
	const stem = path.basename(module_file, path.extname(module_file))

	return name.startsWith(`${stem}.`) && name.endsWith(TEST_SUFFIX)
}

// A test file of the diff runs itself while it is still on disk; a module runs its same-named tests.
function tests_of(root: string, file: string, list: ListDirectory): Array<string> {
	const directory = path.dirname(file)
	const names = list(path.join(root, directory))

	if (file.endsWith(TEST_SUFFIX)) return names.includes(path.basename(file)) ? [file] : []
	if (!related_scope.is_relatable(file)) return []

	return names
		.filter((name) => is_named_after(file, name))
		.map((name) => path.join(directory, name))
}

function touched_tests(
	root: string,
	changed: ReadonlyArray<string>,
	list: ListDirectory = list_directory,
): Array<string> {
	const tests = changed.flatMap((file) => tests_of(root, file, list))

	return [...new Set([...tests, ...test_related_pins.pinned_tests(changed)])]
}

// `changed` is repository-root-relative; `undefined` — a diff git could not read — runs the whole suite,
// as an unreadable change does for the full-reach run.
function touched_scope(
	root: string,
	changed: ReadonlyArray<string> | undefined,
	list: ListDirectory = list_directory,
): RelatedScope {
	const { UNREADABLE_REASON } = related_scope

	if (changed === undefined) return { mode: 'all', files: [], reason: UNREADABLE_REASON }

	const files = touched_tests(root, changed, list).map((file) => path.join(root, file))

	if (files.length === 0) return { mode: 'none', files: [], reason: NOTHING_TOUCHED_REASON }

	return { mode: 'related', files, reason: TOUCHED_REASON }
}

const test_related_touched = {
	NOTHING_TOUCHED_REASON,
	TOUCHED_FLAG,
	TOUCHED_KIND,
	TOUCHED_REASON,
	touched_scope,
	touched_tests,
}

export type { ListDirectory }
export { test_related_touched }
