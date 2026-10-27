import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { direct_importers } from './direct-importers'
import { related_heavy_tests } from './related-heavy-tests'
import { test_pinned_cache_logic, type Recheck } from './test-pinned-cache-logic'
import { test_pinned_ledger, type ProbeTime } from './test-pinned-ledger'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'
import { test_pinned_pool } from './test-pinned-pool'
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
// recheck they no longer fail falls back to every reaching test.

const TREE_PREFIX = 'josh-test-pinned-'
const HEAD = 'HEAD'
const NO_TEST: RedProbe = { verdict: 'no-test', failed: [], ran: 0 }

// One hunk to probe, with the index of its verdict among the caller's hunks.
interface Probe {
	hunk: Hunk
	index: number
	recheck?: Recheck | undefined
}

type OnVerdict = (index: number, verdict: RedProbe) => Promise<void>

// A hunk's related tests in the tree at `root`, narrowed by `josh test:related`'s rule
// (joshuafolkken/kit#5122): a file every test imports reaches the test files importing it directly, not
// the whole suite, and the heavy files a hunk reaches only indirectly are left out. `undefined` when the
// hunk reaches no test.
async function related_selection(
	root: string,
	file: string,
): Promise<ReadonlyArray<string> | undefined> {
	const importers = await direct_importers.every_test_importers(root, [file])
	const files = importers.get(file) ?? [file]

	if (files.length === 0) return undefined

	// vitest is handed the paths relative to the tree it runs in, as the exclusion reads them.
	const scope: RelatedScope = { mode: 'related', files, reason: '' }
	const placed: RelatedScope = { ...scope, files: files.map((test) => path.join(root, test)) }

	return related_scope.vitest_arguments(scope, related_heavy_tests.exclude_flags(placed, root))
}

async function selection_of(
	root: string,
	probe: Probe,
	workers: number,
): Promise<Array<string> | undefined> {
	const tests =
		probe.recheck === undefined
			? await related_selection(root, probe.hunk.file)
			: ['run', ...probe.recheck.recheck]

	if (tests === undefined) return undefined

	return [...tests, ...unit_worker_share.worker_arguments([], workers)]
}

// The run with this one hunk reverted. The file is put back before the next hunk runs, or that hunk's
// tests would also see this revert.
async function reverted_run(tree: BaseTree, probe: Probe, workers: number): Promise<RedProbe> {
	const selection = await selection_of(tree.tree, probe, workers)

	if (selection === undefined) return NO_TEST

	const target = path.join(tree.tree, probe.hunk.file)
	const content = await readFile(target, 'utf8')

	await writeFile(target, test_pinned_logic.revert(content, probe.hunk))

	try {
		return await test_red.probe_in(tree, selection)
	} finally {
		await writeFile(target, content)
	}
}

// The hunk's verdict: its recheck's answer, or a run over every reaching test where it answers none.
async function verdict_of(tree: BaseTree, probe: Probe, workers: number): Promise<RedProbe> {
	const run = await reverted_run(tree, probe, workers)
	if (probe.recheck === undefined) return run

	const answer = test_pinned_cache_logic.rechecked(probe.recheck, run)

	return answer ?? (await reverted_run(tree, { ...probe, recheck: undefined }, workers))
}

// What every lane of one run shares: its workers per tree, the caller's hand-off and the probes' times.
interface Lane {
	workers: number
	on_verdict: OnVerdict
	times: Array<ProbeTime>
}

async function timed_verdict(tree: BaseTree, probe: Probe, lane: Lane): Promise<RedProbe> {
	const started = Date.now()
	const verdict = await verdict_of(tree, probe, lane.workers)

	lane.times.push(test_pinned_ledger.time_of(probe.hunk, verdict, Date.now() - started))

	return verdict
}

// One hunk at a time within a lane: its hunks share the lane's tree (`test-pinned-pool.ts`).
async function verdicts_in(
	tree: BaseTree,
	probes: ReadonlyArray<Probe>,
	lane: Lane,
): Promise<Array<RedProbe>> {
	const verdicts: Array<RedProbe> = []

	for (const probe of probes) {
		// eslint-disable-next-line no-await-in-loop -- the hunks share one tree, so each revert waits for the last restore
		const verdict = await timed_verdict(tree, probe, lane)

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

// The probes, checked over as many trees as the worker budget allows; `paths` are copied into each.
// The run's ledger row counts the `held` hunks the cache answered beside the probed ones' times.
async function checked_on(
	paths: ReadonlyArray<string>,
	probes: ReadonlyArray<Probe>,
	on_verdict: OnVerdict,
	held = 0,
): Promise<Array<RedProbe>> {
	const started = Date.now()
	const times: Array<ProbeTime> = []
	const verdicts = await pooled(paths, probes, { on_verdict, times })

	await test_pinned_ledger.record(held, times, Date.now() - started)

	return verdicts
}

const test_pinned_probe = { checked_on, selection_of }

export type { Probe }
export { test_pinned_probe }
