import { existsSync } from 'node:fs'
import path from 'node:path'
import { direct_importers } from './direct-importers'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_logic } from './test-pinned-logic'
import type { ReachedCount } from './test-pinned-reach'
import { related_scope } from './test-related-scope'
import type { Selection } from './test-related-select'
import { test_symbol_read } from './test-symbol-read'

// **A run never hands vitest more than `test_pinned_logic.MAX_TEST_FILES` test files**
// (`test-related-select.ts`, joshuafolkken/kit#7976): the rest are deferred to CI. This module names
// the files that put a change past the cap — the hubs `lane:plan` splits off before an edit, and the
// one the summary line and the ledger name after a run.

type CountReader = (files: ReadonlyArray<string>) => Promise<Array<ReachedCount> | undefined>

// The code files the cap is read for: in the tree, not a test, and not one every test imports — a
// change of tests alone builds no graph.
function candidates_of(root: string, files: ReadonlyArray<string>): Array<string> {
	const shared = new Set(direct_importers.every_test_imports_of(files))

	return files.filter(
		(file) =>
			related_scope.is_relatable(file) &&
			!test_declared_logic.is_test_file(file) &&
			!shared.has(file) &&
			existsSync(path.join(root, file)),
	)
}

// The reach of each of `files`, root-relative — none for no files or no graph.
async function relative_counts(
	root: string,
	files: ReadonlyArray<string>,
	read_counts: CountReader,
): Promise<Array<ReachedCount>> {
	if (files.length === 0) return []
	const counts = await read_counts(files.map((file) => path.join(root, file)))

	return (counts ?? []).map((reached) => ({ ...reached, file: path.relative(root, reached.file) }))
}

// **A hub is a file whose own reach passes the cap**, not the widest of a spread that only sums past
// it — the tests a whole-file change selects by symbol (joshuafolkken/kit#7980, joshuafolkken/kit#8092).
function over_cap(counts: ReadonlyArray<ReachedCount>): Array<ReachedCount> {
	return counts.filter((reached) => reached.count > test_pinned_logic.MAX_TEST_FILES)
}

// The hubs among `files`, read before any edit so `lane:plan` can split them off
// (joshuafolkken/kit#6543). None without a graph.
async function hubs_of(
	root: string,
	files: ReadonlyArray<string>,
	read_counts: CountReader = test_symbol_read.reached_counts,
): Promise<ReadonlyArray<string>> {
	const counts = await relative_counts(root, candidates_of(root, files), read_counts)

	return over_cap(counts).map((reached) => reached.file)
}

// **The hub is the widest hub of the run's own change** (joshuafolkken/kit#5756): a main merge and
// the map's tree are in the reach too, and a file the lane never edited is no hub of its run. The
// summary line and the lane ledger both name it, so `josh lane:why` reads the hub the run printed
// (joshuafolkken/kit#6187). None where the cap cut nothing or no own file passes it alone.
function hub_of(
	selection: Pick<Selection, 'deferred' | 'reach'>,
	own: ReadonlyArray<string>,
): string | undefined {
	if (selection.deferred === 0) return undefined

	return over_cap(selection.reach.filter((reached) => own.includes(reached.file)))
		.toSorted((first, second) => second.count - first.count)
		.at(0)?.file
}

// The summary line of a run the cap cut, none where it cut nothing: how many test files ran, how many
// were deferred to CI, and the hub.
function deferred_line(selection: Selection, own: ReadonlyArray<string>): string | undefined {
	const { deferred, tests } = selection
	if (deferred === 0) return undefined
	const { COMMAND_LABEL } = related_scope
	const cap = String(test_pinned_logic.MAX_TEST_FILES)
	const hub = hub_of(selection, own)
	const hub_part = hub === undefined ? '' : `, hub ${hub}`

	return `${COMMAND_LABEL}: ${String(tests.length)} test files run, ${String(deferred)} deferred to CI past the cap (${cap} test files)${hub_part}`
}

function report_deferred(selection: Selection, own: ReadonlyArray<string>): void {
	const line = deferred_line(selection, own)

	if (line !== undefined) process.stdout.write(`${line}\n`)
}

const test_related_cap = { deferred_line, hub_of, hubs_of, report_deferred }

export type { CountReader }
export { test_related_cap }
