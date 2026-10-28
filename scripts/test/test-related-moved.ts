import type { MovedParts } from '#scripts/gate/moved-paths'
import { test_declared_logic } from './test-declared-logic'
import type { ReadMap } from './test-read-map'
import { related_scope, type ScopeRequest } from './test-related-scope'
import { test_related_synced, type SyncedSplit } from './test-related-synced'
import { whole_suite_files } from './whole-suite-files'

// How `josh test:related` reads what moved since its last green run (`since-green.ts`) into the change
// it narrows by — split out of `test-related.ts`, which runs the reading.

// The change a narrowing reads, and the map it reads it against. `is_unmoved` is the since-green
// reading's positive fact that nothing moved since this command was last green on this checkout.
// `synced` is the part of the change a main sync brought in, kept for the run's ledger record, and
// `since_map` the part the change since the map's tree joined to what this change moved. `branch` is
// this branch's own change from its merge base, where it was read.
type ChangeReading = Pick<ScopeRequest, 'changed' | 'map' | 'since_map'> & {
	is_unmoved?: true
	synced?: ReadonlyArray<string>
	branch?: ReadonlyArray<string> | undefined
}

function is_whole_suite(file: string): boolean {
	return whole_suite_files.WHOLE_SUITE_FILES.has(file)
}

// **A non-code file a main sync brought in is not this branch's change** (joshuafolkken/kit#4572), so it
// joins `since_map`: it neither adds the tests reading it nor sends the run to the whole suite — main's
// CI verified it. So does a synced file every test depends on, which the split cannot narrow
// (joshuafolkken/kit#4993): main's CI ran the whole suite on it, and this branch's own tests run on it
// anyway. Any other synced module is `test-related-synced.ts`'s: only this branch's change runs for it,
// where the two meet. A branch change git cannot read marks nothing.
function synced_data(
	synced: ReadonlyArray<string>,
	branch: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
	const data = synced.filter((file) => !related_scope.is_relatable(file) || is_whole_suite(file))

	return data.filter((file) => !(branch ?? data).includes(file))
}

// **The branch's own test files stay out of `since_map`** (joshuafolkken/kit#4393), so each runs again
// on every bare run after a green one — the map holds no entry for a read one started since its tree.
// Only main's and another lane's test files are left to CI (joshuafolkken/kit#4896). A branch change git
// cannot read keeps every test file.
function without_own_tests(
	since_map: ReadonlyArray<string>,
	branch: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
	return since_map.filter(
		(file) => !test_declared_logic.is_test_file(file) || branch?.includes(file) === false,
	)
}

// The moved files handed on as explicit arguments, the synced modules the split left out taken away.
// Where one meets this branch's change, the change runs in its place (`test-related-synced.ts`) — named
// even when only the sync moved, since a green branch side would otherwise run nothing.
function narrowed_moved(
	moved: ReadonlyArray<string>,
	split: SyncedSplit,
	branch: ReadonlyArray<string> | undefined,
	map: ReadMap | undefined,
): ReadonlyArray<string> {
	const kept = moved.filter((file) => !split.left.includes(file))
	const own = split.shared.length === 0 ? [] : test_related_synced.own_of(branch, map)

	return [...new Set([...kept, ...(own ?? [])])]
}

// The reading's `since_map`: what this branch did not change. The synced modules left out join it and
// the change, so they settle as reaching no test rather than leaving an empty selection that runs the
// whole suite.
function moved_reading(
	change: ChangeReading,
	parts: MovedParts,
	branch: ReadonlyArray<string> | undefined,
	split: SyncedSplit,
): ChangeReading {
	const since_map = [
		...without_own_tests(change.since_map ?? [], branch),
		...synced_data(parts.synced, branch),
		...split.left,
	]
	const changed = [...new Set([...(change.changed ?? []), ...split.left])]

	return { ...change, changed, since_map: [...new Set(since_map)], synced: parts.synced, branch }
}

const test_related_moved = { is_whole_suite, moved_reading, narrowed_moved }

export type { ChangeReading }
export { test_related_moved }
