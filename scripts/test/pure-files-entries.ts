import path from 'node:path'
import { git_command } from '#scripts/git/git-command'
import { file_reader } from '#scripts/lib/read-file'

// **`tools/test/pure-files.ts` is a whole-suite file only for what is not its entries**
// (joshuafolkken/kit#5001). The vitest config imports it, so `vitest related` widens to every test on
// it, but an entry added, removed or rewritten moves only that test file between the pure and the
// isolated project. A change made of entry lines alone therefore reaches the moved entries and the two
// tests that hold the list to the classifier; any other line — an import, the export — still runs the
// whole suite.

const PURE_FILES_PATH = path.join('tools', 'test', 'pure-files.ts')
const LIST_TESTS: ReadonlyArray<string> = [
	path.join('tools', 'test', 'pure-files.test.ts'),
	path.join('tools', 'test', 'classify-isolation.test.ts'),
]
const ENTRY_LINE = /^\t'(?<entry>[^']+)',$/u

function entry_of(line: string): string | undefined {
	return ENTRY_LINE.exec(line)?.groups?.['entry']
}

function lines_of(text: string): Array<string> {
	return text.trimEnd().split('\n')
}

function frame_of(text: string): string {
	return lines_of(text)
		.filter((line) => entry_of(line) === undefined)
		.join('\n')
}

function entries_of(text: string): Set<string> {
	return new Set(lines_of(text).flatMap((line) => entry_of(line) ?? []))
}

function missing_from(entries: ReadonlySet<string>, other: ReadonlySet<string>): Array<string> {
	return [...entries].filter((entry) => !other.has(entry))
}

// The entries one text holds and the other does not, or `undefined` when anything but entry lines
// differs — the answer that keeps the whole suite.
function moved_entries(before: string, after: string): ReadonlyArray<string> | undefined {
	if (frame_of(before) !== frame_of(after)) return undefined

	const was = entries_of(before)
	const is = entries_of(after)

	return [...missing_from(is, was), ...missing_from(was, is)]
}

// The test files an entries-only change reaches, the list's own tests first.
function tests_of(entries: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...LIST_TESTS, ...entries]
}

async function base_text(): Promise<string | undefined> {
	try {
		return await git_command.show_file(`${await git_command.change_base()}:${PURE_FILES_PATH}`)
	} catch {
		return undefined
	}
}

// The entries this branch moved in the list against its change base, or `undefined` when the list did
// not change, changed beyond its entries, or either side cannot be read.
async function read_moved(
	root: string,
	changed: ReadonlyArray<string> | undefined,
): Promise<ReadonlyArray<string> | undefined> {
	if (changed?.includes(PURE_FILES_PATH) !== true) return undefined

	const before = await base_text()
	const after = file_reader.read_if_readable(path.join(root, PURE_FILES_PATH))

	if (before === undefined || after === undefined) return undefined

	return moved_entries(before, after)
}

const pure_files_entries = { PURE_FILES_PATH, moved_entries, read_moved, tests_of }

export { pure_files_entries }
