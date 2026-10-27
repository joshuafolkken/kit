import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { base_tree, type BaseTree } from '#scripts/git/base-tree'
import { test_pinned_cache_logic, type Recheck } from './test-pinned-cache-logic'
import { test_pinned_ledger, type ProbeTime } from './test-pinned-ledger'
import { test_pinned_logic, type Hunk } from './test-pinned-logic'
import { test_pinned_pool } from './test-pinned-pool'
import { test_red } from './test-red'
import type { RedProbe } from './test-red-logic'
import { test_unit_guard } from './test-unit-guard'
import { unit_worker_share } from './unit-worker-share'

// The probes of `josh test:pinned` (joshuafolkken/kit#4516): each hunk reverted alone in a detached
// worktree at HEAD (`base-tree.ts`), and its related tests run. **Each verdict is handed on as soon as
// it is reached** (joshuafolkken/kit#4936), so the caller stores it before the next hunk runs.
//
// A hunk with a `recheck` runs only those tests — the ones added or edited since its stored `green` or
// `no-test` verdict (`test-pinned-cache-logic.ts`).

const TREE_PREFIX = 'josh-test-pinned-'
const HEAD = 'HEAD'

// One hunk to probe, with the index of its verdict among the caller's hunks.
interface Probe {
	hunk: Hunk
	index: number
	recheck?: Recheck | undefined
}

type OnVerdict = (index: number, verdict: RedProbe) => Promise<void>

function selection_of(probe: Probe, workers: number): Array<string> {
	const tests =
		probe.recheck === undefined
			? ['related', probe.hunk.file, '--run']
			: ['run', ...probe.recheck.recheck]

	return [...tests, ...unit_worker_share.worker_arguments([], workers)]
}

// The verdict with this one hunk reverted. The file is put back before the next hunk runs, or that
// hunk's tests would also see this revert.
async function verdict_of(tree: BaseTree, probe: Probe, workers: number): Promise<RedProbe> {
	const target = path.join(tree.tree, probe.hunk.file)
	const content = await readFile(target, 'utf8')

	await writeFile(target, test_pinned_logic.revert(content, probe.hunk))

	try {
		const verdict = await test_red.probe_in(tree, selection_of(probe, workers))

		return probe.recheck === undefined
			? verdict
			: test_pinned_cache_logic.rechecked(probe.recheck, verdict)
	} finally {
		await writeFile(target, content)
	}
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

const test_pinned_probe = { checked_on }

export type { Probe }
export { test_pinned_probe }
