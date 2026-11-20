import { existsSync } from 'node:fs'
import path from 'node:path'
import { gate_labels } from '#scripts/gate/gate-labels'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { since_green, type FallbackReason } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import { direct_importers } from './direct-importers'
import { test_no_base } from './test-no-base'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related_cap } from './test-related-cap'
import { test_related_moved, type ChangeReading } from './test-related-moved'
import { test_related_record } from './test-related-record'
import { test_related_red, type RedReading, type RelatedInput } from './test-related-red'
import { test_related_reuse, type ReuseMiss } from './test-related-reuse'
import { test_related_run } from './test-related-run'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_related_select } from './test-related-select'
import { test_related_synced } from './test-related-synced'
import { test_related_touched } from './test-related-touched'
import { test_related_verdict } from './test-related-verdict'
import { unit_worker_share } from './unit-worker-share'
import { whole_suite_narrowing } from './whole-suite-narrowing'

// `josh test:related` — the unit check an implementation loop runs between edits.
// The narrowing itself is `test-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches vitest
// through the same guard `josh test:unit` goes through.
//
// **A green run leaves a record of the tree it was green on**, so
// `josh review:brief` can tell a tree this check has read from one it has not. What the record means,
// and the three states in which it is withheld, are `scoped-green.ts`. A red run leaves its failed
// files instead, which the run after the fix reads with what moved (`test-related-red.ts`).

// A failure answers `undefined` rather than an empty list: the two are opposite inputs to
// `resolve_scope`, and only one of them means "could not tell".
async function read_or_undefined<T>(read: () => Promise<T>): Promise<T | undefined> {
	try {
		return await read()
	} catch {
		return undefined
	}
}

async function branch_change(): Promise<ReadonlyArray<string> | undefined> {
	return await read_or_undefined(async () => await changed_paths.read_changed_paths(false))
}

// **The change a map answers for is the change since the tree it was recorded on** — its commit and
// the content its dirty files held then (`test_read_map.changed_since_tree`). A commit git can no
// longer resolve — a pruned or foreign map — leaves the branch change with no map, which runs the
// whole suite on any non-code file.
async function change_since(
	root: string,
	map: ReadMap,
): Promise<ReadonlyArray<string> | undefined> {
	const since = await read_or_undefined(
		async () => await changed_paths.read_changed_since(map.commit),
	)

	if (since === undefined) return undefined

	return test_read_map.changed_since_tree(
		map,
		since,
		input_fingerprint.of_files(root, Object.keys(map.dirty)),
	)
}

// **The map's tree is whichever lane last ran the whole suite green**, so the change since it holds that
// lane's own branch change too (joshuafolkken/kit#4527). What this branch did not change is marked
// `since_map`: it reaches vitest only as a code file naming what moved, and only this branch's change
// can send the run to the whole suite (joshuafolkken/kit#4896). A branch change git cannot read marks nothing.
async function map_change(root: string, map: ReadMap): Promise<ChangeReading> {
	const changed = await change_since(root, map)

	if (changed === undefined) return { changed: await branch_change(), map: undefined }

	const branch = await branch_change()

	if (branch === undefined) return { changed, map }

	return { changed, map, since_map: changed.filter((file) => !branch.includes(file)) }
}

// Explicit file arguments win over the git reading, which is what makes the narrowing testable by
// hand and usable from a hook that already knows which file it just wrote. **The map still answers
// only for the change since its tree**, so that change joins the arguments: a test added since the
// map was recorded is in no entry, and only its own appearance in the change runs it — when it names
// a file the arguments moved (`naming_moved`), as a source file there does.
async function explicit_change(
	root: string,
	explicit: ReadonlyArray<string>,
	map: ReadMap | undefined,
): Promise<ChangeReading> {
	const since = map === undefined ? undefined : await change_since(root, map)

	if (since === undefined) return { changed: explicit, map: undefined }

	const named = new Set(explicit)
	const since_map = since.filter((file) => !named.has(file))

	return { changed: [...named, ...since_map], map, since_map }
}

function red_marked(change: ChangeReading, failed: ReadonlyArray<string>): ChangeReading {
	return failed.length === 0 ? change : { ...change, is_red_rerun: true }
}

// **What moved since this command's last green run** (`since-green.ts`), read as explicit arguments
// are — or since its last red run, joined by the files that failed in it (`test-related-red.ts`). A
// moved file — code or not — reaches the tests reading it as data through the map, whose
// entries hold no module that started reading it after the map's tree; the change since that tree
// joins the list — a code file of it only when it names a moved file (`naming_moved`) — so such a
// module runs the tests importing it. Nothing moved runs nothing; no map, or one git can no longer
// diff against, answers its fallback reason (`since-green.ts`), which reads the whole branch change.
async function since_green_change(
	root: string,
	map: ReadMap | undefined,
	red: RedReading | undefined,
): Promise<ChangeReading | FallbackReason> {
	const reading = await test_related_red.narrowing(red)

	if ('fallback' in reading) return reading.fallback

	const { parts, moved, failed } = reading

	if (moved.length + failed.length === 0) return { changed: [], map, is_unmoved: true }

	const branch = await branch_change()
	const split = await test_related_synced.split(root, parts.synced, branch, map)
	const change = await explicit_change(
		root,
		[...test_related_moved.narrowed_moved(moved, split, branch, map), ...failed],
		map,
	)

	if (change.map === undefined) return since_green.FALLBACK.NO_READ_MAP

	process.stdout.write(`${test_related_red.describe(reading)}\n`)

	return red_marked(test_related_moved.moved_reading(change, parts, branch, split), failed)
}

async function whole_change(
	root: string,
	map: ReadMap | undefined,
	red: RedReading | undefined,
): Promise<ChangeReading> {
	const since = await since_green_change(root, map, red)

	if (typeof since !== 'string') return since

	process.stdout.write(`${since_green.fallback_line(gate_labels.UNIT_LABEL, since)}\n`)

	return map === undefined ? { changed: await branch_change(), map } : await map_change(root, map)
}

function explicit_files(root: string, command_arguments: ReadonlyArray<string>): Array<string> {
	return command_arguments
		.filter((argument) => !changed_file_scope.is_flag(argument))
		.map((file) => path.relative(root, path.resolve(file)))
}

async function read_change(
	root: string,
	command_arguments: ReadonlyArray<string>,
	red: RedReading | undefined,
): Promise<ChangeReading> {
	const map = test_read_map.read_map(root)
	const explicit = explicit_files(root, command_arguments)

	return explicit.length > 0
		? await explicit_change(root, explicit, map)
		: await whole_change(root, map, red)
}

// **The changed non-code files the map's tree held and that did not already differ from it** — the
// ones whose having no reader in the map means no test reads them. A file that was dirty when the
// map was recorded is left out, since the tree the tests read then was not the commit's. A git
// failure holds none, which runs the whole suite on any of them.
async function recorded_files(change: ChangeReading): Promise<ReadonlySet<string>> {
	const { changed, map } = change

	if (changed === undefined || map === undefined) return new Set()

	const dirty = new Set(Object.keys(map.dirty))
	const candidates = changed.filter((file) => !related_scope.is_relatable(file) && !dirty.has(file))

	return new Set(
		await read_or_undefined(async () => await changed_paths.read_held_at(map.commit, candidates)),
	)
}

// **The code files of the change since the map that name a file this change moved** — read off their
// text, the one place a file-system read added since the map's tree shows (`is_code_input` in
// `test-related-scope.ts`, joshuafolkken/kit#4532). A file the tree no longer holds names nothing. A
// file every test depends on is never one: handed to vitest it runs the whole suite unannounced, and
// only this branch's own change of it may do that (joshuafolkken/kit#4993). **Only this branch's own
// change names**, where it was read: a main sync's file — a shared test, or one main deleted — would
// match main's own sources, which vitest widens to hundreds of tests (joshuafolkken/kit#5041).
function naming_moved(root: string, change: ChangeReading): ReadonlySet<string> {
	const { changed = [], since_map = [], branch = changed } = change
	const names = changed
		.filter((file) => !since_map.includes(file) && branch.includes(file))
		.map((file) => path.basename(file))
	const code = since_map.filter(
		(file) => related_scope.is_relatable(file) && !test_related_moved.is_whole_suite(file),
	)

	// Each file's text is read once, however many names it is checked for.
	return new Set(
		code.filter((file) =>
			test_no_base.names_any(test_no_base.text_of(path.join(root, file)), names),
		),
	)
}

// What the change reaches; `test-related-select.ts` then caps the test files it runs.
async function scope_of(root: string, change: ChangeReading): Promise<RelatedScope> {
	const recorded = await recorded_files(change)
	const naming = naming_moved(root, change)
	const narrowing = await whole_suite_narrowing.read(root, change.changed)

	return related_scope.resolve_scope({
		root,
		...change,
		...narrowing,
		recorded,
		naming_moved: naming,
		is_present: existsSync,
	})
}

type Selected = Pick<
	RelatedInput,
	'scope' | 'deferred' | 'reach' | 'select_elapsed_ms' | 'select_method'
>

// **The run's test files, capped** (joshuafolkken/kit#7976) — in every checkout, the gate's unit leg
// on main included: the whole suite is CI's (joshuafolkken/kit#7977). The selection's own time
// — the import graph and the importer index (joshuafolkken/kit#7248) — is recorded apart from vitest's.
// The summary line names the hub the ledger records: the widest file of the run's own change.
async function selected_of(
	root: string,
	change: ChangeReading,
	scope: RelatedScope,
): Promise<Selected> {
	if (scope.mode === 'none') return { scope }
	const started_ms = performance.now()
	const named = test_related_record.named_of(change)
	const selection = await test_related_select.select(root, scope, named)
	const select_elapsed_ms = performance.now() - started_ms
	const { deferred, reach, method } = selection

	test_related_cap.report_deferred(selection, test_related_record.own_of(change))

	return {
		scope: test_related_select.scope_of(root, scope, selection),
		deferred,
		reach,
		select_elapsed_ms,
		select_method: method,
	}
}

// **Whether a set of changed files can reach any test**, answered by the decision this command
// narrows with, so the gate's reuse of a green unit step (`check-inputs.ts`) can never trust a change
// this command would have run tests for. Unknown reaches: no map, or one recorded on a tree git can
// no longer diff against. The change since the map joins the paths as it does for explicit
// arguments, so a test added or edited after the map was recorded still reaches when it names a path.
async function reaches_tests(root: string, paths: ReadonlyArray<string>): Promise<boolean> {
	if (paths.length === 0) return false

	const change = await explicit_change(root, paths, test_read_map.read_map(root))

	if (change.map === undefined) return true

	const scope = await scope_of(root, change)

	return scope.mode !== 'none'
}

async function resolve_change(root: string, change: ChangeReading): Promise<RelatedScope> {
	const { UNMOVED_REASON } = related_scope

	if (change.is_unmoved === true) return { mode: 'none', files: [], reason: UNMOVED_REASON }

	return await scope_of(root, change)
}

// What the last red run left owed, and whether it narrowed this run (joshuafolkken/kit#7786).
function red_fields(
	red: RedReading | undefined,
	change: ChangeReading,
): Pick<RelatedInput, 'owed' | 'red_rerun'> {
	return { owed: red?.owed ?? [], red_rerun: change.is_red_rerun === true }
}

// The tree reuse compares against, and why it gets none (joshuafolkken/kit#8283): a red record owes
// its failed files, a scoping argument vouches for no tree, else no gate tree was read.
function reuse_input(
	command_arguments: ReadonlyArray<string>,
	red: RedReading | undefined,
	before: GateTree | undefined,
): { tree: GateTree | undefined; miss: ReuseMiss } {
	const { MISS } = test_related_reuse

	if (red !== undefined) return { tree: undefined, miss: MISS.AFTER_RED }

	const is_scoped = unit_worker_share.without_worker_flags(command_arguments).length > 0

	return { tree: before, miss: is_scoped ? MISS.SCOPED_ARGUMENTS : MISS.NO_TREE }
}

async function read_run_input(
	root: string,
	command_arguments: ReadonlyArray<string>,
	before: GateTree | undefined,
): Promise<RelatedInput> {
	const red = await test_related_red.read_red(before)
	const change = await read_change(root, command_arguments, red)
	const { changed, synced = [], since_map = [], branch } = change
	const resolved = await resolve_change(root, change)
	const selected = await selected_of(root, change, resolved)
	const { tree, miss } = reuse_input(command_arguments, red, before)
	const reuse = await test_related_reuse.read(root, resolved, tree, miss)

	return {
		root,
		changed,
		synced,
		since_map,
		branch,
		...red_fields(red, change),
		reuse,
		...selected,
	}
}

// A non-code argument is resolved through the map, and a file every test imports through the whole
// suite's selection, rather than handed to vitest, so only the other code arguments can be ones vitest
// was not given.
function report_unhanded(
	root: string,
	command_arguments: ReadonlyArray<string>,
	input: RelatedInput,
): void {
	changed_file_scope.report_unusable_arguments(
		command_arguments.filter(
			(argument) =>
				related_scope.is_relatable(argument) &&
				!direct_importers.is_every_test_import(root, argument),
		),
		input.scope,
		related_scope.COMMAND_LABEL,
	)
}

// **A `--touched` run is the implementation loop's** (`test-related-touched.ts`): it reads its scope off
// the change alone. Its separate review-fix record never answers the gate's full-reach reuse.
async function run_touched(given: ReadonlyArray<string>): Promise<number> {
	const { TOUCHED_FLAG, TOUCHED_KIND } = test_related_touched
	const command_arguments = given.filter((argument) => argument !== TOUCHED_FLAG)
	const root = await changed_file_scope.repository_root_or_cwd()
	const explicit = explicit_files(root, command_arguments)
	const changed = explicit.length > 0 ? explicit : await branch_change()
	const scope = await test_related_touched.read_scope(root, changed)
	const input = { scope, root, changed, synced: [], since_map: [], kind: TOUCHED_KIND }

	return await test_related_run.run_and_record(input, command_arguments)
}

// A green run records the tree it was green on, a red one the files it failed on
// (`test-related-red.ts`), so the run after a fix reads only those and what moved.
async function run_fresh(
	command_arguments: ReadonlyArray<string>,
	tree: GateTree | undefined,
): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const scoping = unit_worker_share.without_worker_flags(command_arguments)
	const before = scoping.length === 0 ? tree : undefined
	const input = await read_run_input(root, command_arguments, before)
	// The branch change by half and base, for the ledger alone (joshuafolkken/kit#6982).
	const branch_parts = await read_or_undefined(changed_paths.read_changed_parts)

	report_unhanded(root, command_arguments, input)

	return await test_related_run.run_and_vouch(
		{ ...input, branch_parts, tree: before },
		command_arguments,
		before,
	)
}

async function run_related_tests(given: ReadonlyArray<string>): Promise<number> {
	return await test_related_verdict.run(
		unit_worker_share.without_worker_flags(given),
		async (before) =>
			given.includes(test_related_touched.TOUCHED_FLAG)
				? await run_touched(given)
				: await run_fresh(given, before),
	)
}

const test_related = { reaches_tests, run_related_tests }

export { test_related }
