import type { ImportMap } from './direct-importers'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { test_registry_readers } from './test-registry-readers'
import type { TypeScript } from './test-symbol-bindings'
import { test_symbol_resolve } from './test-symbol-resolve'
import { test_symbol_users, type Reach, type Source, type SymbolIndex } from './test-symbol-users'

// **The test files a change selects by the users of what it changed** (joshuafolkken/kit#7980, the
// depth decided in #7979): every user is followed, but the command map passes a change on to its own
// tests alone, and where that still selects more than the cap the walk falls back to one file
// boundary. A test that mocks a changed module whole does not run on it; a changed command registry
// entry selects the tests naming the command.

const HUB_KEYS: ReadonlySet<string> = new Set(['scripts/josh/josh-command-map.ts::COMMAND_MAP'])
const FULL: Reach = { max_hops: Infinity, stops: HUB_KEYS }
const ONE_HOP: Reach = { max_hops: 1, stops: HUB_KEYS }
// The line before a pure deletion's gap and the line after it.
const DELETION_SPAN = 2

// The changed lines of each changed file, a file with none listed (untracked) changed whole.
type ChangedLines = ReadonlyMap<string, ReadonlyArray<number>>

interface SymbolInput {
	typescript: TypeScript
	sources: ReadonlyArray<Source>
	changed: ReadonlyArray<string>
	lines: ChangedLines
	imports: ImportMap
}

// Root-relative test files selected, each changed code file's count of them, and among them the
// direct users — those within one file boundary, which a cut keeps first (joshuafolkken/kit#8091).
interface SymbolSelection {
	tests: Array<string>
	reach: Array<ReachedCount>
	direct: Array<string>
}

type Reached = Omit<SymbolSelection, 'direct'>

interface Selecting {
	input: SymbolInput
	index: SymbolIndex
	tests: ReadonlyArray<Source>
}

function line_count(text: string): number {
	return text.split('\n').length
}

function lines_of(selecting: Selecting, source: Source): ReadonlyArray<number> {
	const listed = selecting.input.lines.get(source.file)
	if (listed !== undefined) return listed

	return Array.from({ length: line_count(source.text) }, (_, index) => index + 1)
}

function is_mocking(index: SymbolIndex, test: string, file: string): boolean {
	return index.facts.get(test)?.mocks.has(file) === true
}

function registry_tests(
	selecting: Selecting,
	source: Source,
	lines: ReadonlyArray<number>,
): Array<string> {
	if (!test_registry_readers.is_registry(source.file)) return []
	const commands = test_registry_readers.changed_commands(selecting.input.typescript, source, lines)

	return test_registry_readers.readers_of(commands, selecting.tests)
}

// One changed file's tests: its changed declarations' users within `reach`, less the tests mocking it.
function tests_of(selecting: Selecting, source: Source, reach: Reach): Array<string> {
	const { index } = selecting
	const lines = lines_of(selecting, source)
	const seeds = test_symbol_users.changed_keys(index, source.file, lines)
	const users = [...test_symbol_users.select(index, seeds, reach)].filter(
		(test) => !is_mocking(index, test, source.file),
	)

	return [...new Set([...users, ...registry_tests(selecting, source, lines)])]
}

function selection_at(selecting: Selecting, reach: Reach): Reached {
	const changed = new Set(selecting.input.changed)
	const sources = selecting.input.sources.filter((source) => changed.has(source.file))
	const each = sources.map((source) => ({
		file: source.file,
		tests: tests_of(selecting, source, reach),
	}))

	return {
		tests: [...new Set(each.flatMap((item) => item.tests))],
		reach: each.map(({ file, tests }) => ({ file, count: tests.length })),
	}
}

function selecting_of(input: SymbolInput): Selecting {
	const { build } = test_symbol_users
	const resolve = test_symbol_resolve.resolver(input.sources, input.imports)
	const index = build(input.typescript, resolve, input.sources)
	const tests = input.sources.filter((source) => test_declared_logic.is_test_file(source.file))

	return { input, index, tests }
}

// Every user followed, or one file boundary where that selects more than the cap.
function select_within(selecting: Selecting): SymbolSelection {
	const direct = selection_at(selecting, ONE_HOP)
	const full = selection_at(selecting, FULL)
	const chosen = full.tests.length > test_pinned_logic.MAX_TEST_FILES ? direct : full

	return { ...chosen, direct: direct.tests }
}

function select_from(input: SymbolInput): SymbolSelection {
	return select_within(selecting_of(input))
}

// Each changed file's count as though it changed alone, over one index — so one wide file does not
// send the others to the one-hop fallback.
function counts_from(input: SymbolInput): Array<ReachedCount> {
	const selecting = selecting_of(input)

	return input.changed.map((file) => {
		const alone = { ...selecting, input: { ...input, changed: [file] } }

		return { file, count: select_within(alone).tests.length }
	})
}

// A hunk's lines in the new file; a pure deletion, after its `new_start`, marks the lines either side.
function hunk_lines(hunk: Hunk): Array<number> {
	const length = hunk.new_count === 0 ? DELETION_SPAN : hunk.new_count

	return Array.from({ length }, (_, index) => hunk.new_start + index)
}

// Each file's changed lines from a `-U0` diff.
function changed_lines(diff: string): Map<string, Array<number>> {
	const lines = new Map<string, Array<number>>()

	for (const hunk of test_pinned_logic.all_hunks(diff)) {
		lines.set(hunk.file, [...(lines.get(hunk.file) ?? []), ...hunk_lines(hunk)])
	}

	return lines
}

const test_symbol_select = { changed_lines, counts_from, select_from }

export type { ChangedLines, SymbolInput, SymbolSelection }
export { test_symbol_select }
