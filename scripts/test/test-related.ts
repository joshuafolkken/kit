import { existsSync } from 'node:fs'
import path from 'node:path'
import type { GateTree } from '#scripts/gate/gate-tree'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { changed_paths } from '#scripts/git/changed-paths'
import { review_stamps } from '#scripts/review/review-stamps'
import { test_declared_logic } from './test-declared-logic'
import { test_read_map, type ReadMap } from './test-read-map'
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
type ChangeReading = Pick<ScopeRequest, 'changed' | 'map'> & { is_unmoved?: true }

const UNMOVED_REASON = 'nothing moved since its last green run on this checkout'

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

// **The change a map answers for is the change since the tree it was recorded on**, plus what
// already differed from that tree then. A commit git can no longer resolve — a pruned or foreign
// map — leaves the branch change with no map, which runs the whole suite on any non-code file.
async function change_since(map: ReadMap): Promise<ReadonlyArray<string> | undefined> {
	const since = await read_or_undefined(
		async () => await changed_paths.read_changed_since(map.commit),
	)

	return since === undefined ? undefined : [...new Set([...since, ...map.dirty])]
}

async function map_change(map: ReadMap): Promise<ChangeReading> {
	const changed = await change_since(map)

	if (changed === undefined) return { changed: await branch_change(), map: undefined }

	return { changed, map }
}

// Explicit file arguments win over the git reading, which is what makes the narrowing testable by
// hand and usable from a hook that already knows which file it just wrote. **The map still answers
// only for the change since its tree**, so that change joins the arguments: a test added since the
// map was recorded is in no entry, and only its own appearance in the change runs it.
async function explicit_change(
	explicit: ReadonlyArray<string>,
	map: ReadMap | undefined,
): Promise<ChangeReading> {
	const since = map === undefined ? undefined : await change_since(map)

	if (since === undefined) return { changed: explicit, map: undefined }

	return { changed: [...new Set([...explicit, ...since])], map }
}

// **A moved non-code file is never narrowed by**: it reaches tests through the map alone, and a
// branch source that started reading it after the map's tree is in no entry, so an untouched test
// reading it through that source would be missed. The whole branch change runs it.
function is_map_read(moved: ReadonlyArray<string>): boolean {
	return moved.some((file) => !related_scope.is_relatable(file))
}

// **What moved since this command's last green run, plus the branch's own test files**
// (`since-green.ts`). A branch test is in no map entry for a file it started reading on the branch, so
// a file it reads that moved since would otherwise reach no test; listing it runs it, as the change
// since the map does. Nothing moved runs nothing; `undefined` reads the whole branch change instead.
async function since_green_change(map: ReadMap | undefined): Promise<ChangeReading | undefined> {
	const moved = await since_green.read_moved(review_stamps.test_related_stamp)

	if (moved === undefined || is_map_read(moved)) return undefined
	if (moved.length === 0) return { changed: [], map, is_unmoved: true }

	const branch = await branch_change()

	if (branch === undefined) return undefined

	process.stdout.write(`${since_green.describe(related_scope.COMMAND_LABEL, moved)}\n`)

	const tests = branch.filter((file) => test_declared_logic.is_test_file(file))

	return { changed: [...new Set([...moved, ...tests])], map }
}

async function whole_change(map: ReadMap | undefined): Promise<ChangeReading> {
	const since = await since_green_change(map)

	if (since !== undefined) return since

	return map === undefined ? { changed: await branch_change(), map } : await map_change(map)
}

async function read_change(
	root: string,
	command_arguments: ReadonlyArray<string>,
): Promise<ChangeReading> {
	const map = test_read_map.read_map(root)
	const explicit = command_arguments
		.filter((argument) => !changed_file_scope.is_flag(argument))
		.map((file) => path.relative(root, path.resolve(file)))

	return explicit.length > 0 ? await explicit_change(explicit, map) : await whole_change(map)
}

// **The changed non-code files the map's tree held and that did not already differ from it** — the
// ones whose having no reader in the map means no test reads them. A file that was dirty when the
// map was recorded is left out, since the tree the tests read then was not the commit's. A git
// failure holds none, which runs the whole suite on any of them.
async function recorded_files(change: ChangeReading): Promise<ReadonlySet<string>> {
	const { changed, map } = change

	if (changed === undefined || map === undefined) return new Set()

	const dirty = new Set(map.dirty)
	const candidates = changed.filter((file) => !related_scope.is_relatable(file) && !dirty.has(file))

	return new Set(
		await read_or_undefined(async () => await changed_paths.read_held_at(map.commit, candidates)),
	)
}

// **Whether a set of changed files can reach any test**, answered by the decision this command
// narrows with, so the gate's reuse of a green unit step (`check-inputs.ts`) can never trust a change
// this command would have run tests for. Unknown reaches: no map, or one recorded on a tree git can
// no longer diff against. The change since the map joins the paths as it does for explicit
// arguments, so a test added or edited after the map was recorded still reaches.
async function reaches_tests(root: string, paths: ReadonlyArray<string>): Promise<boolean> {
	if (paths.length === 0) return false

	const change = await explicit_change(paths, test_read_map.read_map(root))

	if (change.map === undefined) return true

	const recorded = await recorded_files(change)
	const scope = related_scope.resolve_scope({ root, ...change, recorded, is_present: existsSync })

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

async function read_scope(
	root: string,
	command_arguments: ReadonlyArray<string>,
): Promise<RelatedScope> {
	const change = await read_change(root, command_arguments)

	if (change.is_unmoved === true) return { mode: 'none', files: [], reason: UNMOVED_REASON }

	const recorded = await recorded_files(change)

	return related_scope.resolve_scope({ root, ...change, recorded, is_present: existsSync })
}

async function run_related_tests(command_arguments: ReadonlyArray<string>): Promise<number> {
	const root = await changed_file_scope.repository_root_or_cwd()
	const scope = await read_scope(root, command_arguments)

	// A non-code argument is resolved through the map rather than handed to vitest, so only the
	// code arguments can be ones vitest was not given.
	changed_file_scope.report_unusable_arguments(
		command_arguments.filter((argument) => related_scope.is_relatable(argument)),
		scope,
		related_scope.COMMAND_LABEL,
	)

	const before = await scoped_green.read_before(command_arguments)
	const exit_code = await run_scope(scope, root, command_arguments)

	await scoped_green.record_if_green(review_stamps.test_related_stamp, {
		before: conclusive_tree(before),
		exit_code,
	})

	return exit_code
}

const test_related = { reaches_tests, run_related_tests }

export { test_related }
