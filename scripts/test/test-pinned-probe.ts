import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { direct_importers } from './direct-importers'
import { related_heavy_tests } from './related-heavy-tests'
import { test_pinned_cache_logic, type Recheck } from './test-pinned-cache-logic'
import {
	test_pinned_ledger,
	type PinnedOrigin,
	type ProbeTime,
	type Skipped,
} from './test-pinned-ledger'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'
import { test_pinned_pool } from './test-pinned-pool'
import { test_pinned_stage, type Staged, type StagePlan } from './test-pinned-stage'
import { test_pinned_type_check } from './test-pinned-type-check'
import { test_red } from './test-red'
import type { RedProbe } from './test-red-logic'
import { related_scope, type RelatedScope } from './test-related-scope'
import { test_unit_guard } from './test-unit-guard'
import { unit_worker_share } from './unit-worker-share'

// The probes of `josh test:pinned` (joshuafolkken/kit#4516): each hunk reverted alone in a detached
// worktree at HEAD (`base-tree.ts`), and its related tests run. **Each verdict is handed on as soon as
// it is reached** (joshuafolkken/kit#4936), so the caller stores it before the next hunk runs.
//
// A hunk with a `recheck` runs only those tests — the ones added or edited since its stored `green` or
// `no-test` verdict, or the ones its stored `red` failed in (`test-pinned-cache-logic.ts`); a `red`
// recheck they no longer fail falls back to a fresh probe, which runs in stages where the file's reach
// is wide (`test-pinned-stage.ts`), type-checked between the stages (`test-pinned-type-check.ts`).

const TREE_PREFIX = 'josh-test-pinned-'
const HEAD = 'HEAD'
const NO_TEST: RedProbe = { verdict: 'no-test', failed: [], ran: 0 }

// One hunk to probe, with the index of its verdict among the caller's hunks and how many test files
// its file reaches, where a graph counted them.
interface Probe {
	hunk: Hunk
	index: number
	recheck?: Recheck | undefined
	reach?: number | undefined
}

type OnVerdict = (index: number, verdict: RedProbe) => Promise<void>

async function direct_of(root: string, file: string): Promise<Array<string>> {
	const importers = await direct_importers.importers_of(root, [file])

	return importers.get(file) ?? []
}

// What a fresh probe of the hunk runs in the tree at `root` (`test-pinned-stage.ts`). A file every
// test imports stays the special case of joshuafolkken/kit#5122: its direct importers alone, never
// escalated, since its reach is the whole suite — and `vitest related` handed it runs the whole suite.
async function plan_of(root: string, probe: Probe): Promise<StagePlan> {
	const { file } = probe.hunk

	if (direct_importers.every_test_imports_of([file]).length > 0) {
		return { reach: await direct_of(root, file) }
	}

	if (probe.reach === undefined) return { reach: [file] }

	return test_pinned_stage.plan_over(file, await direct_of(root, file), probe.reach)
}

// The tests `files` reach in the tree at `root`, the heavy files reached only indirectly left out
// (`josh test:related`'s rule). `undefined` when there are none.
function selection_over(
	root: string,
	files: ReadonlyArray<string>,
	workers: number,
): Array<string> | undefined {
	if (files.length === 0) return undefined

	// vitest is handed the paths relative to the tree it runs in, as the exclusion reads them.
	const scope: RelatedScope = { mode: 'related', files, reason: '' }
	const placed: RelatedScope = { ...scope, files: files.map((test) => path.join(root, test)) }
	const flags = related_heavy_tests.exclude_flags(placed, root)

	return [
		...related_scope.vitest_arguments(scope, flags),
		...unit_worker_share.worker_arguments([], workers),
	]
}

function recheck_selection(recheck: Recheck, workers: number): Array<string> {
	return ['run', ...recheck.recheck, ...unit_worker_share.worker_arguments([], workers)]
}

// The probe's first run: its recheck, or the first stage of its plan.
async function selection_of(
	root: string,
	probe: Probe,
	workers: number,
): Promise<Array<string> | undefined> {
	if (probe.recheck !== undefined) return recheck_selection(probe.recheck, workers)
	const plan = await plan_of(root, probe)

	return selection_over(root, plan.direct ?? plan.reach, workers)
}

// `action` with this one hunk reverted. The file is put back before the next hunk runs, or that hunk's
// tests would also see this revert.
async function with_revert<T>(tree: BaseTree, hunk: Hunk, action: () => Promise<T>): Promise<T> {
	const target = path.join(tree.tree, hunk.file)
	const content = await readFile(target, 'utf8')

	await writeFile(target, test_pinned_logic.revert(content, hunk))

	try {
		return await action()
	} finally {
		await writeFile(target, content)
	}
}

async function reverted_run(
	tree: BaseTree,
	hunk: Hunk,
	selection: ReadonlyArray<string> | undefined,
): Promise<RedProbe> {
	if (selection === undefined) return NO_TEST

	return await with_revert(tree, hunk, async () => await test_red.probe_in(tree, selection))
}

// Whether the type check over the hunk's file and its direct importers reads red with it reverted and
// green without: a scope already red before the revert answers nothing.
async function is_reverted_type_red(tree: BaseTree, hunk: Hunk): Promise<boolean> {
	const scope = await test_pinned_type_check.scope_of(hunk.file)
	if (scope.length === 0 || (await test_pinned_type_check.is_red(tree, scope))) return false

	return await with_revert(tree, hunk, async () => await test_pinned_type_check.is_red(tree, scope))
}

// Set once a probe is unpinned in a `--first-unpinned` run (joshuafolkken/kit#5153): no lane starts
// another probe, and the ones already running finish and hand their verdicts on.
interface Halt {
	is_set: boolean
}

// What every lane of one run shares: its workers per tree, the caller's hand-off, the probes' times,
// how many probes ran in stages, and the halt a `--first-unpinned` run carries.
interface Lane {
	workers: number
	on_verdict: OnVerdict
	times: Array<ProbeTime>
	staged: Staged
	halt?: Halt | undefined
}

// The hunk's verdict over every stage of its plan.
async function fresh_verdict(tree: BaseTree, probe: Probe, lane: Lane): Promise<RedProbe> {
	const plan = await plan_of(tree.tree, probe)

	async function run(files: ReadonlyArray<string>): Promise<RedProbe> {
		return await reverted_run(tree, probe.hunk, selection_over(tree.tree, files, lane.workers))
	}

	async function is_type_red(): Promise<boolean> {
		return await is_reverted_type_red(tree, probe.hunk)
	}

	return await test_pinned_stage.staged_verdict(plan, run, is_type_red, lane.staged)
}

// The hunk's verdict: its recheck's answer, or a fresh probe where it answers none.
async function verdict_of(tree: BaseTree, probe: Probe, lane: Lane): Promise<RedProbe> {
	if (probe.recheck === undefined) return await fresh_verdict(tree, probe, lane)
	const selection = recheck_selection(probe.recheck, lane.workers)
	const run = await reverted_run(tree, probe.hunk, selection)

	return (
		test_pinned_cache_logic.rechecked(probe.recheck, run) ??
		(await fresh_verdict(tree, probe, lane))
	)
}

function halt_on(lane: Lane, verdict: RedProbe): void {
	if (lane.halt !== undefined && test_pinned_logic.is_unpinned(verdict)) lane.halt.is_set = true
}

async function timed_verdict(tree: BaseTree, probe: Probe, lane: Lane): Promise<RedProbe> {
	const started = Date.now()
	const verdict = await verdict_of(tree, probe, lane)

	lane.times.push(test_pinned_ledger.time_of(probe.hunk, verdict, Date.now() - started))

	return verdict
}

// One hunk at a time within a lane: its hunks share the lane's tree (`test-pinned-pool.ts`). A set
// halt starts no further hunk, so the lane answers fewer than it was dealt.
async function verdicts_in(
	tree: BaseTree,
	probes: ReadonlyArray<Probe>,
	lane: Lane,
): Promise<Array<RedProbe>> {
	const verdicts: Array<RedProbe> = []

	for (const probe of probes) {
		if (lane.halt?.is_set === true) break
		// eslint-disable-next-line no-await-in-loop -- the hunks share one tree, so each revert waits for the last restore
		const verdict = await timed_verdict(tree, probe, lane)

		halt_on(lane, verdict)
		// eslint-disable-next-line no-await-in-loop -- stored before the next hunk runs, so a stopped run keeps it
		await lane.on_verdict(probe.index, verdict)
		verdicts.push(verdict)
	}

	return verdicts
}

async function pooled(
	paths: ReadonlyArray<string>,
	probes: ReadonlyArray<Probe>,
	lane: Omit<Lane, 'workers'>,
): Promise<Array<RedProbe>> {
	if (probes.length === 0) return []
	const plan = test_pinned_pool.lane_plan(probes.length, await test_unit_guard.vitest_share([]))

	return await test_pinned_pool.run_pool(
		probes,
		plan.lanes,
		async (group) =>
			await base_tree.with_tree(TREE_PREFIX, HEAD, async (tree) => {
				await base_tree.copy_in(tree.tree, paths)

				return await verdicts_in(tree, group, { ...lane, workers: plan.workers })
			}),
	)
}

// `held` counts the hunks the cache answered, `rewired` the ones left out as a rewire
// (`test-pinned-rewire.ts`), `over_cap` the ones over the test-file cap; `is_first_unpinned` starts
// no probe once one is unpinned.
interface CheckOptions {
	held?: number
	rewired?: number
	over_cap?: number
	is_first_unpinned?: boolean
	origin?: PinnedOrigin | undefined
}

// The verdicts reached, in the probes' order, and how many of the probes ran in stages.
interface Checked {
	verdicts: Array<RedProbe>
	staged: Staged
}

function skipped_of(options: CheckOptions): Skipped {
	return {
		held: options.held ?? 0,
		rewired: options.rewired ?? 0,
		over_cap: options.over_cap ?? 0,
		origin: options.origin,
	}
}

// The probes, checked over as many trees as the worker budget allows; `paths` are copied into each.
// The run's ledger row counts the `held` hunks beside the probed ones' times. Under
// `is_first_unpinned`, the verdicts are the ones started before the first unpinned verdict.
async function checked_on(
	paths: ReadonlyArray<string>,
	probes: ReadonlyArray<Probe>,
	on_verdict: OnVerdict,
	options: CheckOptions = {},
): Promise<Checked> {
	const started = Date.now()
	const times: Array<ProbeTime> = []
	const staged = test_pinned_stage.none()
	const halt = options.is_first_unpinned === true ? { is_set: false } : undefined
	const verdicts = await pooled(paths, probes, { on_verdict, times, staged, halt })

	await test_pinned_ledger.record(skipped_of(options), times, Date.now() - started)

	return { verdicts, staged }
}

const test_pinned_probe = { checked_on, selection_of }

export type { CheckOptions, Checked, Probe }
export { test_pinned_probe }
