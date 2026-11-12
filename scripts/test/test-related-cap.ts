import { existsSync } from 'node:fs'
import path from 'node:path'
import { direct_importers } from './direct-importers'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_logic } from './test-pinned-logic'
import { test_pinned_reach, type ReachedCount } from './test-pinned-reach'
import { test_related_pins } from './test-related-pins'
import { related_scope } from './test-related-scope'

// **A change whose imports reach more than `test_pinned_logic.MAX_TEST_FILES` test files runs only the
// tests importing its widest files directly** (joshuafolkken/kit#5532, #5702), as a file every test imports does
// (`direct-importers.ts`): the tests past them stay unchecked here, for `josh gate`'s whole suite and
// CI to run. `--keep-whole-suite` (the gate's unit leg) lifts the cap outside a lane
// (`test-related-whole.ts`), and so does a missing graph.

type CountReader = (files: ReadonlyArray<string>) => Promise<Array<ReachedCount> | undefined>

// The changed files that narrow to their direct importers, each with those importers, and the ones of
// them the cap narrowed — widest reach first, so the first is the hub that put the run past the cap
// (joshuafolkken/kit#5699).
interface CappedImporters {
	importers: ReadonlyMap<string, ReadonlyArray<string>>
	over_cap: ReadonlyArray<string>
}

const NO_CAP: CappedImporters = { importers: new Map(), over_cap: [] }

function reach_sum(counts: ReadonlyArray<ReachedCount>): number {
	return counts.reduce((sum, reached) => sum + reached.count, 0)
}

// Widest reach first, until the reach of the files left whole sums within the cap: past the cap is the
// change, not one file — a spread of files each under it runs as wide as one hub (joshuafolkken/kit#5702).
function over_cap_of(
	counts: ReadonlyArray<ReachedCount>,
	max_tests = test_pinned_logic.MAX_TEST_FILES,
): Array<string> {
	const widest = counts.toSorted((first, second) => second.count - first.count)
	const fits = widest.findIndex((_, index) => reach_sum(widest.slice(index)) <= max_tests)
	const narrowed = fits === -1 ? widest : widest.slice(0, fits)

	return narrowed.map((reached) => reached.file)
}

// The code files the cap is read for: in the tree, not a test, and not narrowed already — a change of
// tests alone builds no graph.
function candidates_of(
	root: string,
	files: ReadonlyArray<string>,
	narrowed: ReadonlyMap<string, unknown>,
): Array<string> {
	return files.filter(
		(file) =>
			related_scope.is_relatable(file) &&
			!test_declared_logic.is_test_file(file) &&
			!narrowed.has(file) &&
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

async function read_over_cap(
	root: string,
	files: ReadonlyArray<string>,
	read_counts: CountReader,
): Promise<Array<string>> {
	return over_cap_of(await relative_counts(root, files, read_counts))
}

// A file past the cap that no test imports directly keeps its whole reach: narrowed, it would run no
// test at all. A registry file narrows to its direct importers and the pinned registry tests
// (`test-related-pins.ts`).
async function direct_of(
	root: string,
	over_cap: ReadonlyArray<string>,
): Promise<Array<[string, Array<string>]>> {
	const importers = await direct_importers.importers_of(root, over_cap)
	const narrowed = [...importers].filter(([, tests]) => tests.length > 0)

	return narrowed.map(([file, tests]) => [file, test_related_pins.with_pins(file, tests)])
}

// The files every test imports, and the other code files of `files` whose reach is read.
async function split_of(
	root: string,
	files: ReadonlyArray<string>,
): Promise<[Map<string, Array<string>>, Array<string>]> {
	const every_test = await direct_importers.every_test_importers(root, files)

	return [every_test, candidates_of(root, files, every_test)]
}

// `files` are repository-root-relative, as the change was read. `is_whole` keeps the whole suite:
// nothing narrows, and no graph is built.
async function capped_importers(
	root: string,
	files: ReadonlyArray<string>,
	is_whole: boolean,
	read_counts: CountReader = test_pinned_reach.reached_test_counts,
): Promise<CappedImporters> {
	if (is_whole) return NO_CAP
	const [every_test, candidates] = await split_of(root, files)
	const over_cap = await read_over_cap(root, candidates, read_counts)
	const capped = await direct_of(root, over_cap)

	return { importers: new Map([...every_test, ...capped]), over_cap: capped.map(([file]) => file) }
}

// The hubs among `files`, read before any edit so `lane:plan` can split them off
// (joshuafolkken/kit#6543): each file whose own reach passes the cap — a narrowed one or one no test
// imports directly, which keeps its whole reach — not the widest of a spread that only sums past it.
// None without a graph.
async function hubs_of(
	root: string,
	files: ReadonlyArray<string>,
	read_counts: CountReader = test_pinned_reach.reached_test_counts,
): Promise<ReadonlyArray<string>> {
	const [, candidates] = await split_of(root, files)
	const counts = await relative_counts(root, candidates, read_counts)

	return counts.flatMap((reached) => over_cap_of([reached]))
}

// The test files the capped files run instead of their reach — their direct importers and a registry's
// pinned tests, counted once.
function capped_test_count(capped: CappedImporters): number {
	const tests = capped.over_cap.flatMap((file) => capped.importers.get(file) ?? [])

	return new Set(tests).size
}

// **The hub is the widest capped file of the run's own change** (joshuafolkken/kit#5756): the cap reads
// the whole input, a main merge and the map's tree among it, and a file the lane never edited is no hub
// of its run. The summary line and the lane ledger both name it, so `josh lane:why` reads the hub the
// run printed (joshuafolkken/kit#6187).
function hub_of(over_cap: ReadonlyArray<string>, own: ReadonlyArray<string>): string | undefined {
	return over_cap.find((file) => own.includes(file))
}

// The summary line of a capped run, none where the cap narrowed nothing: the hub, and how many test
// files ran in place of the reach (joshuafolkken/kit#5699).
function over_cap_line(capped: CappedImporters, own: ReadonlyArray<string>): string | undefined {
	const { over_cap } = capped
	if (over_cap.length === 0) return undefined
	const { COMMAND_LABEL } = related_scope
	const cap = String(test_pinned_logic.MAX_TEST_FILES)
	const ran = String(capped_test_count(capped))
	const hub = hub_of(over_cap, own)
	const hub_part = hub === undefined ? '' : `, hub ${hub}`

	return `${COMMAND_LABEL}: ${String(over_cap.length)} over cap (${cap} test files)${hub_part} — ${ran} test files run, the rest unchecked: ${over_cap.join(', ')}`
}

function report_over_cap(capped: CappedImporters, own: ReadonlyArray<string>): void {
	const line = over_cap_line(capped, own)

	if (line !== undefined) process.stdout.write(`${line}\n`)
}

const test_related_cap = {
	NO_CAP,
	capped_importers,
	hub_of,
	hubs_of,
	over_cap_line,
	over_cap_of,
	report_over_cap,
}

export type { CappedImporters, CountReader }
export { test_related_cap }
