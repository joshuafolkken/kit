import { existsSync } from 'node:fs'
import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { moved_paths } from '#scripts/gate/moved-paths'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import { review_stamps } from '#scripts/review/review-stamps'
import { direct_importers } from './direct-importers'
import { pure_files_entries } from './pure-files-entries'
import { related_heavy_tests } from './related-heavy-tests'
import { test_no_base } from './test-no-base'
import { test_pinned_reach } from './test-pinned-reach'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related_moved, type ChangeReading } from './test-related-moved'
import { test_related_record, type RunInput } from './test-related-record'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_related_synced } from './test-related-synced'
import { test_unit_guard } from './test-unit-guard'

// `josh test:related` — the unit check an implementation loop runs between edits.
// The narrowing itself is `test-related-scope.ts` over the shared
// decision in `changed-file-scope.ts`; this is the process around it — how the run reaches vitest
// through the same guard `josh test:unit` goes through.
//
// **A green run leaves a record of the tree it was green on**, so
// `josh review:brief` can tell a tree this check has read from one it has not. What the record means,
// and the three states in which it is withheld, are `scoped-green.ts`.

// **A skipped vitest exits 0, and a zero from a run that started nothing must vouch for no tree.**
// `test_unit_guard.report_no_run` returns 0 on its skip branch — vitest not installed — so in a
// project with no unit suite the record would say the tests were green over a run in which none
// executed, and `josh review:brief` would stop refusing on the strength of it. **The guard's own
// decision is asked again rather than re-derived here**, so the two can never disagree; it is asked
// only when a record is otherwise due, since the question costs a project-wide glob. A basic project's
// own test script counts as a run: it executes the whole suite, which covers any narrowing.
function conclusive_tree(before: GateTree | undefined): GateTree | undefined {
	if (before === undefined) return undefined

	return test_unit_guard.is_running(process.cwd()) ? before : undefined
}

// A failure answers `undefined` rather than an empty list: the two are opposite inputs to
// `resolve_scope`, and only one of them means "could not tell".
async function read_or_undefined(
	read: () => Promise<ReadonlyArray<string>>,
): Promise<ReadonlyArray<string> | undefined> {
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

// **The whole-suite leg never narrows by a green a bare run recorded past a file every test imports**:
// that green vouches only for the file's direct importers (joshuafolkken/kit#5122), so while this
// branch changes one, the gate's unit leg reads the whole branch change.
async function is_green_narrowable(is_whole: boolean): Promise<boolean> {
	if (!is_whole) return true

	return direct_importers.every_test_imports_of((await branch_change()) ?? []).length === 0
}

// **What moved since this command's last green run** (`since-green.ts`), read as explicit arguments
// are. A moved file — code or not — reaches the tests reading it as data through the map, whose
// entries hold no module that started reading it after the map's tree; the change since that tree
// joins the list — a code file of it only when it names a moved file (`naming_moved`) — so such a
// module runs the tests importing it. Nothing moved runs nothing; no map,
// or one git can no longer diff against, answers `undefined`, which reads the whole branch change.
async function since_green_change(
	root: string,
	map: ReadMap | undefined,
	is_whole: boolean,
): Promise<ChangeReading | undefined> {
	const parts = (await is_green_narrowable(is_whole))
		? await since_green.read_moved_parts(review_stamps.test_related_stamp, gate_plan.UNIT_LABEL)
		: undefined

	if (parts === undefined) return undefined

	const moved = moved_paths.union_of(parts)

	if (moved.length === 0) return { changed: [], map, is_unmoved: true }

	const branch = await branch_change()
	const split = await test_related_synced.split(root, parts.synced, branch, map)
	const change = await explicit_change(
		root,
		test_related_moved.narrowed_moved(moved, split, branch, map),
		map,
	)

	if (change.map === undefined) return undefined

	process.stdout.write(`${since_green.describe(related_scope.COMMAND_LABEL, moved)}\n`)

	return test_related_moved.moved_reading(change, parts, branch, split)
}

async function whole_change(
	root: string,
	map: ReadMap | undefined,
	is_whole: boolean,
): Promise<ChangeReading> {
	const since = await since_green_change(root, map, is_whole)

	if (since !== undefined) return since

	return map === undefined ? { changed: await branch_change(), map } : await map_change(root, map)
}

async function read_change(
	root: string,
	command_arguments: ReadonlyArray<string>,
	is_whole: boolean,
): Promise<ChangeReading> {
	const map = test_read_map.read_map(root)
	const explicit = command_arguments
		.filter((argument) => !changed_file_scope.is_flag(argument))
		.map((file) => path.relative(root, path.resolve(file)))

	return explicit.length > 0
		? await explicit_change(root, explicit, map)
		: await whole_change(root, map, is_whole)
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

// A file every test imports narrows to its direct importers unless `is_whole`: the gate's unit leg, and
// the gate's reuse of it, keep the whole suite for it (`gate_plan.KEEP_WHOLE_SUITE_FLAG`).
async function scope_of(
	root: string,
	change: ChangeReading,
	is_whole: boolean,
): Promise<RelatedScope> {
	const recorded = await recorded_files(change)
	const naming = naming_moved(root, change)
	const pure_entries = await pure_files_entries.read_moved(root, change.changed)
	const narrowed = is_whole ? [] : (change.changed ?? [])
	const importers = await direct_importers.every_test_importers(root, narrowed)

	return related_scope.resolve_scope({
		root,
		...change,
		recorded,
		naming_moved: naming,
		pure_entries,
		every_test_importers: importers,
		is_present: existsSync,
	})
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

	const scope = await scope_of(root, change, true)

	return scope.mode !== 'none'
}

// The cores a run claims once its scope is known (joshuafolkken/kit#5135): a narrowed scope by the
// test files its imports reach — not by its own files, one of which may reach hundreds — and the whole
// suite, or a scope no graph can be built for, by the full width a direct unit run holds.
async function claim_weight(scope: RelatedScope): Promise<number> {
	const tests =
		scope.mode === 'related' ? await test_pinned_reach.reached_test_count(scope.files) : undefined

	return tests === undefined ? gate_plan.direct_unit_weight() : gate_plan.scoped_unit_weight(tests)
}

// **The claim is taken here, not declared on the command entry**: the entry is reserved before the
// scope resolves, so it could only ever claim the whole width. `vitest_share` reads this claim back
// as the `--maxWorkers` bound. Under `josh gate` the gate's claim covers the run, so none is sized.
async function run_claimed(scope: RelatedScope, run: () => Promise<number>): Promise<number> {
	if (core_budget.is_covered()) return await run()

	const weight = await claim_weight(scope)

	return await core_budget.with_command_reservation(weight, run, {
		memory_mb: gate_plan.unit_memory(weight),
		command: related_scope.COMMAND_NAME,
		is_unit: true,
	})
}

// A change known to reach no test succeeds without starting vitest, and says why.
async function run_scope(
	scope: RelatedScope,
	root: string,
	command_arguments: ReadonlyArray<string>,
): Promise<number> {
	const description = related_scope.describe_scope(scope, root)

	if (scope.mode === 'none') {
		process.stdout.write(`${description}\n`)

		return 0
	}

	const vitest_arguments = related_scope.vitest_arguments(scope, [
		...changed_file_scope.flags_of(command_arguments),
		...related_heavy_tests.exclude_flags(scope, root),
	])

	return await run_claimed(
		scope,
		async () =>
			await test_unit_guard.run_guarded_vitest(
				process.cwd(),
				vitest_arguments,
				related_scope.COMMAND_NAME,
				description,
			),
	)
}

async function resolve_change(
	root: string,
	change: ChangeReading,
	is_whole: boolean,
): Promise<RelatedScope> {
	const { UNMOVED_REASON } = related_scope

	if (change.is_unmoved === true) return { mode: 'none', files: [], reason: UNMOVED_REASON }

	return await scope_of(root, change, is_whole)
}

async function read_run_input(
	root: string,
	command_arguments: ReadonlyArray<string>,
	is_whole: boolean,
): Promise<RunInput> {
	const change = await read_change(root, command_arguments, is_whole)
	const scope = await resolve_change(root, change, is_whole)

	const { changed, synced = [], since_map = [], branch } = change

	return { scope, root, changed, synced, since_map, branch }
}

// Every run is timed and counted into the lane ledger (joshuafolkken/kit#4465).
async function run_and_record(
	input: RunInput,
	command_arguments: ReadonlyArray<string>,
): Promise<number> {
	const started = performance.now()
	const { exit_code, test_files } = await test_related_record.with_test_count(
		async () => await run_scope(input.scope, input.root, command_arguments),
	)

	await test_related_record.record_run(input, {
		elapsed_ms: performance.now() - started,
		test_files,
	})

	return exit_code
}

// **The no-base pass is part of the run's verdict**, so a green record — the one `josh ship` and the
// gate reuse — never vouches for a tree whose base-touching code fails in CI's checkout. It runs
// only after a green first pass (`test-no-base.ts`), and only over this branch's own files: those
// the map's tree or a main sync joined were verified by main's CI.
async function with_no_base_pass(
	input: RunInput,
	command_arguments: ReadonlyArray<string>,
	exit_code: number,
): Promise<number> {
	if (exit_code !== 0) return exit_code

	const flags = changed_file_scope.flags_of(command_arguments)
	const joined = new Set([...input.since_map, ...input.synced])
	const own = (input.changed ?? []).filter((file) => !joined.has(file))

	return await test_no_base.run_if_touched(input.root, own, flags)
}

// A non-code argument is resolved through the map, and a file every test imports through its
// importers, rather than handed to vitest, so only the other code arguments can be ones vitest was not
// given.
function report_unhanded(
	root: string,
	command_arguments: ReadonlyArray<string>,
	scope: RelatedScope,
): void {
	changed_file_scope.report_unusable_arguments(
		command_arguments.filter(
			(argument) =>
				related_scope.is_relatable(argument) &&
				!direct_importers.is_every_test_import(root, argument),
		),
		scope,
		related_scope.COMMAND_LABEL,
	)
}

async function run_related_tests(given: ReadonlyArray<string>): Promise<number> {
	const { KEEP_WHOLE_SUITE_FLAG } = gate_plan
	const command_arguments = given.filter((argument) => argument !== KEEP_WHOLE_SUITE_FLAG)
	const root = await changed_file_scope.repository_root_or_cwd()
	const input = await read_run_input(root, command_arguments, given.includes(KEEP_WHOLE_SUITE_FLAG))

	report_unhanded(root, command_arguments, input.scope)

	const before = await scoped_green.read_before(command_arguments)
	const exit_code = await with_no_base_pass(
		input,
		command_arguments,
		await run_and_record(input, command_arguments),
	)

	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before: conclusive_tree(before),
		exit_code,
	})

	return exit_code
}

const test_related = { reaches_tests, run_related_tests }

export { test_related }
