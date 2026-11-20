import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { change_base } from '#scripts/git/change-base'
import { changed_paths } from '#scripts/git/changed-paths'
import { outer_command } from '#scripts/josh/outer-command'
import { lane_child_marker, type MarkerSource } from '#scripts/lane/lane-child-marker'
import { direct_importers } from './direct-importers'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related_pins } from './test-related-pins'
import { related_scope, type RelatedScope } from './test-related-scope'

// `josh test:related --touched` — the implementation loop's re-check (joshuafolkken/kit#5237). A change
// near a hub reaches hundreds of test files, and paying that reach after every small edit repeats it
// minutes apart. **The touched scope reads no import graph, and of the test-read map only the
// listings**: it is the diff's own test files and, for each changed module `foo.ts`, its colocated
// `foo.test.ts` and `foo.*.test.ts`, plus the tests the change pins (`test-related-pins.ts`), its
// modules' direct test importers, and the readers that list the directory of a file added or removed
// (`test_read_map.listing_readers_of`, joshuafolkken/kit#8275) — a test enumerating a directory imports
// no file added there. No map, no listing readers. The full-reach run checks further away. A touched
// green admits review round 2, and the lane ledger records it under its own kind.

const TOUCHED_FLAG = '--touched'
const TOUCHED_KIND = 'touched'
const TEST_SUFFIX = '.test.ts'
const TOUCHED_REASON =
	"the diff test files, their modules' same-named tests, direct test importers, listers of an added or removed file and pinned tests"
const NOTHING_TOUCHED_REASON = 'no changed file reaches a touched test'
const COMMAND = 'test:related'
const LANE_NOTICE =
	'test:related: a lane call runs the --touched scope; check:related runs the full reach'

type ListDirectory = (directory: string) => ReadonlyArray<string>

// Where a `josh test:related` call was typed: its checkout, its environment and its notice line.
interface CallSite {
	directory: string
	source: MarkerSource
	notify: (line: string) => void
}

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

// **A lane's own bare call runs the touched scope** (joshuafolkken/kit#7593): the full reach is paid
// later by `check:related` and the ship's scoped pair, so a lane child that typed `josh test:related`
// while implementing gets `--touched`. A call another josh command made (`outer-command.ts`) and a
// call outside a lane keep the full reach. The flag joins the arguments, so the green record is the
// touched one and never answers a full-reach reuse.
function is_lane_direct(directory: string, source: MarkerSource): boolean {
	return (
		outer_command.is_outermost(COMMAND, source) && lane_child_marker.is_child_of(directory, source)
	)
}

function live_call_site(): CallSite {
	return { directory: process.cwd(), source: process.env, notify: console.info }
}

function scoped_arguments(
	given: ReadonlyArray<string>,
	site: CallSite = live_call_site(),
): ReadonlyArray<string> {
	if (given.length > 0 || !is_lane_direct(site.directory, site.source)) return given
	site.notify(LANE_NOTICE)

	return [TOUCHED_FLAG]
}

// The readers the map records listing a changed file's directory; none without a map.
function listing_readers(changed: ReadonlyArray<string>, map: ReadMap | undefined): Array<string> {
	if (map === undefined) return []

	return [...new Set(changed.flatMap((file) => test_read_map.listing_readers_of(map, file)))]
}

// **A listing moves only when an entry appears or goes**: a file the change base did not hold, or one
// it held that is gone from disk. An edit in place lists the same, so it adds no listing reader —
// tests walking the whole tree list every directory, and would join every touched run.
function entry_moves(
	changed: ReadonlyArray<string>,
	held: ReadonlySet<string>,
	is_on_disk: (file: string) => boolean,
): Array<string> {
	return changed.filter((file) => !held.has(file) || !is_on_disk(file))
}

// With no change base every changed file counts, the safe side.
async function moved_entries(root: string, changed: ReadonlyArray<string>): Promise<Array<string>> {
	const base = await change_base.resolved_through_merge()

	if (base === undefined) return [...changed]

	const held = new Set(await changed_paths.read_held_at(base, changed))

	return entry_moves(changed, held, (file) => existsSync(path.join(root, file)))
}

// git is asked only when the map has a lister to offer.
async function listing_tests(root: string, changed: ReadonlyArray<string>): Promise<Array<string>> {
	const map = test_read_map.read_map(root)

	if (listing_readers(changed, map).length === 0) return []

	return listing_readers(await moved_entries(root, changed), map)
}

// A shared fixture often has no same-named test. Reuse the direct-import scan, without building
// a transitive graph, so its consuming suites run before the shipping checks (joshuafolkken/kit#7380).
// A listing reader joins the same way: a test runs itself, a module its same-named tests.
async function read_scope(
	root: string,
	changed: ReadonlyArray<string> | undefined,
): Promise<RelatedScope> {
	if (changed === undefined) return touched_scope(root, changed)

	const importers = await direct_importers.importers_of(
		root,
		changed.filter((file) => related_scope.is_relatable(file)),
	)
	const reached = [...[...importers.values()].flat(), ...(await listing_tests(root, changed))]

	return touched_scope(root, [...changed, ...reached])
}

const test_related_touched = {
	NOTHING_TOUCHED_REASON,
	TOUCHED_FLAG,
	TOUCHED_KIND,
	TOUCHED_REASON,
	entry_moves,
	listing_readers,
	read_scope,
	scoped_arguments,
	touched_scope,
	touched_tests,
}

export type { CallSite, ListDirectory }
export { test_related_touched }
