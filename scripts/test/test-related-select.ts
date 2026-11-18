import { existsSync } from 'node:fs'
import path from 'node:path'
import { direct_importers } from './direct-importers'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach, type ReachedCount, type ReachedTests } from './test-pinned-reach'
import { test_related_pins } from './test-related-pins'
import { related_scope, type RelatedScope } from './test-related-scope'

// **The test files `josh test:related` hands vitest, never more than `test_pinned_logic.MAX_TEST_FILES`**
// (joshuafolkken/kit#7976): the whole suite is CI's, so a local run never widens to it, whatever the
// change. Three layers, each sorted by path so a cut is the same on every run: the changed tests
// themselves, then the scope's own tests and the tests importing a changed code file directly — a
// read-map reader among them — then the tests the change reaches past those. A scope that fell to the
// whole suite, or a tree with no graph, reaches every test file. What the cap cuts is `deferred`: the
// ledger and the summary line count it, and CI runs it.

const UNIT_TEST_SUFFIX = '.test.ts'
const NO_TEST_REASON = 'no unit test file reaches the change'

// Root-relative test files to run, how many the cap cut, and each changed code file's reach.
interface Selection {
	tests: ReadonlyArray<string>
	deferred: number
	reach: ReadonlyArray<ReachedCount>
}

// The readers selecting goes through, injectable so a test needs no graph.
interface SelectReaders {
	reach: (files: ReadonlyArray<string>) => Promise<Array<ReachedTests> | undefined>
	importers: (root: string, files: ReadonlyArray<string>) => Promise<Map<string, Array<string>>>
	all_tests: () => Promise<ReadonlyArray<string>>
}

async function all_tests(): Promise<ReadonlyArray<string>> {
	return await test_pinned_reach.work_tree_files()
}

const READERS: SelectReaders = {
	reach: test_pinned_reach.reached_tests,
	importers: direct_importers.importers_of,
	all_tests,
}

// A vitest test file: the e2e suite is Playwright's, and a file no longer in the tree runs nothing.
function is_unit_test(root: string, file: string): boolean {
	return file.endsWith(UNIT_TEST_SUFFIX) && existsSync(path.join(root, file))
}

// By code point, not locale, so a cut is the same on every machine.
function by_path(first: string, second: string): number {
	if (first === second) return 0

	return first < second ? -1 : 1
}

// The layers in order, each by path, a file in the first layer holding it; cut at `max_tests`.
function capped_layers(
	layers: ReadonlyArray<ReadonlyArray<string>>,
	max_tests = test_pinned_logic.MAX_TEST_FILES,
): Pick<Selection, 'tests' | 'deferred'> {
	const ordered = [...new Set(layers.flatMap((layer) => layer.toSorted(by_path)))]

	return { tests: ordered.slice(0, max_tests), deferred: Math.max(0, ordered.length - max_tests) }
}

// The files the scope settled on, root-relative: a narrowed scope's own, else the change itself.
function seeds_of(
	root: string,
	scope: RelatedScope,
	changed: ReadonlyArray<string> | undefined,
): Array<string> {
	if (scope.mode === 'related') return scope.files.map((file) => path.relative(root, file))

	return (changed ?? []).filter((file) => existsSync(path.join(root, file)))
}

// A file's direct importers, and a registry file's pinned registry tests (`test-related-pins.ts`).
function pinned(file: string, tests: ReadonlyArray<string>): ReadonlyArray<string> {
	return test_related_pins.with_pins(file, [...tests])
}

function is_code(file: string): boolean {
	return related_scope.is_relatable(file) && !test_declared_logic.is_test_file(file)
}

// The outer layer, root-relative: what the code files reach, or every test where the scope fell to the
// whole suite or no graph could be built.
async function outer_of(
	root: string,
	scope: RelatedScope,
	reached: ReadonlyArray<ReachedTests> | undefined,
	readers: SelectReaders,
): Promise<ReadonlyArray<string>> {
	const is_whole = scope.mode === 'all'
	const tests =
		reached === undefined || is_whole
			? await readers.all_tests()
			: reached.flatMap((each) => each.tests)

	return tests.map((test) => path.relative(root, path.resolve(test)))
}

function reach_of(
	root: string,
	reached: ReadonlyArray<ReachedTests> | undefined,
): Array<ReachedCount> {
	return (reached ?? []).map(({ file, tests }) => ({
		file: path.relative(root, file),
		count: tests.length,
	}))
}

// `changed` is root-relative, as the change was read; a `none` scope selects nothing.
async function select(
	root: string,
	scope: RelatedScope,
	changed: ReadonlyArray<string> | undefined,
	readers: SelectReaders = READERS,
): Promise<Selection> {
	if (scope.mode === 'none') return { tests: [], deferred: 0, reach: [] }
	const seeds = seeds_of(root, scope, changed)
	const code = seeds.filter((file) => is_code(file))
	const direct = await readers.importers(root, code)
	const reached = await readers.reach(code.map((file) => path.join(root, file)))
	const near = [...seeds, ...[...direct].flatMap(([file, tests]) => pinned(file, tests))]
	const outer = await outer_of(root, scope, reached, readers)
	const layers = [changed ?? [], near, outer].map((layer) =>
		layer.filter((file) => is_unit_test(root, file)),
	)

	return { ...capped_layers(layers), reach: reach_of(root, reached) }
}

// The scope handed to vitest: its own reading with the selected tests, absolute — or none where
// nothing was selected, since `vitest run` with no file runs the whole suite.
function scope_of(root: string, scope: RelatedScope, selection: Selection): RelatedScope {
	if (scope.mode === 'none') return scope

	if (selection.tests.length === 0) {
		return { mode: 'none', files: scope.files, reason: NO_TEST_REASON }
	}

	return { ...scope, tests: selection.tests.map((test) => path.join(root, test)) }
}

const test_related_select = { NO_TEST_REASON, capped_layers, scope_of, select }

export type { SelectReaders, Selection }
export { test_related_select }
