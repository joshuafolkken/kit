import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { gate_plan } from '#scripts/gate/gate-plan'
import type { GateTree } from '#scripts/gate/gate-tree'
import { input_fingerprint } from '#scripts/gate/input-fingerprint'
import { moved_paths } from '#scripts/gate/moved-paths'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_read_map, type ReadMap } from './test-read-map'
import { test_related_record, type RunInput } from './test-related-record'
import { related_scope, type RelatedScope, type ScopeRequest } from './test-related-scope'
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

// The change a narrowing reads, and the map it reads it against. `is_unmoved` is the since-green
// reading's positive fact that nothing moved since this command was last green on this checkout.
// `synced` is the part of the change a main sync brought in, kept for the run's ledger record, and
// `since_map` the part the change since the map's tree joined to what this change moved.
type ChangeReading = Pick<ScopeRequest, 'changed' | 'map' | 'since_map'> & {
	is_unmoved?: true
	synced?: ReadonlyArray<string>
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
// `since_map`: it still reaches its readers — a source file only when it names what moved — but only
// this branch's change can send the run to the whole suite. A branch change git cannot read marks nothing.
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
// map was recorded is in no entry, and only its own appearance in the change runs it — a source file
// there only when it names a file the arguments moved (`naming_moved`).
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

// **A non-code file a main sync brought in is not this branch's change** (joshuafolkken/kit#4572), so it
// joins `since_map`: it still reaches the tests reading it, but never sends the run to the whole suite —
// main's CI verified it. A synced module stays a moved file, so `vitest related` still walks to the
// tests importing it, a branch-only one among them. A branch change git cannot read marks nothing.
async function synced_data(synced: ReadonlyArray<string>): Promise<ReadonlyArray<string>> {
	const data = synced.filter((file) => !related_scope.is_relatable(file))

	if (data.length === 0) return []

	const branch = (await branch_change()) ?? data

	return data.filter((file) => !branch.includes(file))
}

// **What moved since this command's last green run** (`since-green.ts`), read as explicit arguments
// are. A moved file — code or not — reaches the tests reading it as data through the map, whose
// entries hold no module that started reading it after the map's tree; the change since that tree
// joins the list — its test files, and a source file only when it names a moved file
// (`naming_moved`) — so such a module runs the tests importing it. Nothing moved runs nothing; no map,
// or one git can no longer diff against, answers `undefined`, which reads the whole branch change.
async function since_green_change(
	root: string,
	map: ReadMap | undefined,
): Promise<ChangeReading | undefined> {
	const parts = await since_green.read_moved_parts(
		review_stamps.test_related_stamp,
		gate_plan.UNIT_LABEL,
	)

	if (parts === undefined) return undefined

	const moved = moved_paths.union_of(parts)

	if (moved.length === 0) return { changed: [], map, is_unmoved: true }

	const change = await explicit_change(root, moved, map)

	if (change.map === undefined) return undefined

	process.stdout.write(`${since_green.describe(related_scope.COMMAND_LABEL, moved)}\n`)

	const since_map = [...(change.since_map ?? []), ...(await synced_data(parts.synced))]

	return { ...change, since_map, synced: parts.synced }
}

async function whole_change(root: string, map: ReadMap | undefined): Promise<ChangeReading> {
	const since = await since_green_change(root, map)

	if (since !== undefined) return since

	return map === undefined ? { changed: await branch_change(), map } : await map_change(root, map)
}

async function read_change(
	root: string,
	command_arguments: ReadonlyArray<string>,
): Promise<ChangeReading> {
	const map = test_read_map.read_map(root)
	const explicit = command_arguments
		.filter((argument) => !changed_file_scope.is_flag(argument))
		.map((file) => path.relative(root, path.resolve(file)))

	return explicit.length > 0
		? await explicit_change(root, explicit, map)
		: await whole_change(root, map)
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

function text_of(file_path: string): string {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return ''
	}
}

// Each file's text is read once, however many names it is checked for.
function names_any(text: string, names: ReadonlyArray<string>): boolean {
	return names.some((name) => text.includes(name))
}

// **The code files of the change since the map that name a file this change moved** — read off their
// text, the one place a file-system read added since the map's tree shows (`is_code_input` in
// `test-related-scope.ts`, joshuafolkken/kit#4532). A file the tree no longer holds names nothing.
function naming_moved(root: string, change: ChangeReading): ReadonlySet<string> {
	const { changed = [], since_map = [] } = change
	const names = changed
		.filter((file) => !since_map.includes(file))
		.map((file) => path.basename(file))
	const code = since_map.filter((file) => related_scope.is_relatable(file))

	return new Set(code.filter((file) => names_any(text_of(path.join(root, file)), names)))
}

async function scope_of(root: string, change: ChangeReading): Promise<RelatedScope> {
	const recorded = await recorded_files(change)
	const naming = naming_moved(root, change)

	return related_scope.resolve_scope({
		root,
		...change,
		recorded,
		naming_moved: naming,
		is_present: existsSync,
	})
}

// **Whether a set of changed files can reach any test**, answered by the decision this command
// narrows with, so the gate's reuse of a green unit step (`check-inputs.ts`) can never trust a change
// this command would have run tests for. Unknown reaches: no map, or one recorded on a tree git can
// no longer diff against. The change since the map joins the paths as it does for explicit
// arguments, so a test added or edited after the map was recorded still reaches.
async function reaches_tests(root: string, paths: ReadonlyArray<string>): Promise<boolean> {
	if (paths.length === 0) return false

	const change = await explicit_change(root, paths, test_read_map.read_map(root))

	if (change.map === undefined) return true

	const scope = await scope_of(root, change)

	return scope.mode !== 'none'
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

	return await test_unit_guard.run_guarded_vitest(
		process.cwd(),
		related_scope.vitest_arguments(scope, changed_file_scope.flags_of(command_arguments)),
		related_scope.COMMAND_NAME,
		description,
	)
}

async function resolve_change(root: string, change: ChangeReading): Promise<RelatedScope> {
	const { UNMOVED_REASON } = related_scope

	if (change.is_unmoved === true) return { mode: 'none', files: [], reason: UNMOVED_REASON }

	return await scope_of(root, change)
}

async function read_run_input(
	root: string,
	command_arguments: ReadonlyArray<string>,
): Promise<RunInput> {
	const change = await read_change(root, command_arguments)
	const scope = await resolve_change(root, change)

	const { changed, synced = [], since_map = [] } = change

	return { scope, root, changed, synced, since_map }
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

async function run_related_tests(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const input = await read_run_input(root, command_arguments)

	// A non-code argument is resolved through the map rather than handed to vitest, so only the
	// code arguments can be ones vitest was not given.
	changed_file_scope.report_unusable_arguments(
		command_arguments.filter((argument) => related_scope.is_relatable(argument)),
		input.scope,
		related_scope.COMMAND_LABEL,
	)

	const before = await scoped_green.read_before(command_arguments)
	const exit_code = await run_and_record(input, command_arguments)

	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before: conclusive_tree(before),
		exit_code,
	})

	return exit_code
}

const test_related = { reaches_tests, run_related_tests }

export { test_related }
