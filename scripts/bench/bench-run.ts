import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { buffered_process } from '#scripts/buffered-process'
import { bench_guard } from './bench-guard'
import type { BenchReading, BenchSample } from './bench-report'
import { bench_targets, type BenchTarget } from './bench-targets'

// Taking the readings `bench-report.ts` aggregates (joshuafolkken/kit#1314).
//
// One cycle is: remove this target's caches, run it, run it again. The second run reads the caches
// the first one just wrote, so "warm" is produced by the measurement rather than assumed from
// whatever state the checkout happened to be in.
//
// **What is removed is not decided here.** `bench-targets.ts` declares it per target and filters it
// through `is_clearable`, so a path this module could reach is one the gate itself declares as its
// own cache file — every one of them git-ignored, which is what makes a run leave the working tree
// as it found it.

const JOSH = 'josh'

function cache_path(root: string, cache: string): string {
	return path.join(root, cache)
}

// `force` so a cache that was never written is not an error — the first `josh bench` in a fresh
// checkout is the common case, and there is nothing to remove.
function clear_caches(target: BenchTarget, root: string): ReadonlyArray<string> {
	const caches = bench_targets.clearable_caches(target)

	for (const cache of caches) rmSync(cache_path(root, cache), { force: true })

	return caches
}

interface TargetRun {
	elapsed_ms: number
	is_failed: boolean
	// The child's own output, carried rather than written here: a red check fails both phases of every
	// cycle, so printing at this level would dump the same transcript six times for `--repeat 3`.
	output: string
}

async function run_target(target: BenchTarget): Promise<TargetRun> {
	const result = await buffered_process.run_buffered_process([JOSH, target.name, ...target.flags])

	return {
		elapsed_ms: result.elapsed_ms,
		is_failed: buffered_process.is_process_failed(result),
		output: result.output,
	}
}

// One cycle, and the first failing transcript it produced. **The guard is asked here rather than once
// at start-up**: a default run is minutes long and clears a target's caches before every cold reading,
// so a gate started by a hook after the first check would otherwise be walked straight into.
async function take_reading(
	target: BenchTarget,
	root: string,
): Promise<{ reading: BenchReading; failure_output: string }> {
	bench_guard.assert_no_gate()
	clear_caches(target, root)

	const cold = await run_target(target)
	const warm = await run_target(target)
	const failed = [cold, warm].find((phase) => phase.is_failed)

	return {
		reading: {
			cold_ms: cold.elapsed_ms,
			warm_ms: warm.elapsed_ms,
			is_failed: failed !== undefined,
		},
		failure_output: failed?.output ?? '',
	}
}

// **A failed reading shows why it failed, once.** Its figure is excluded from the row, so without any
// transcript the user is left with `2 reading(s) exited non-zero, excluded` and nothing to act on —
// and the usual cause is a genuinely red check that wants fixing before anything is measured at all.
async function measure_target(
	target: BenchTarget,
	repetitions: number,
	root: string,
): Promise<BenchSample> {
	const readings: Array<BenchReading> = []
	let failure_output = ''

	for (let round = 0; round < repetitions; round += 1) {
		const taken = await take_reading(target, root)

		readings.push(taken.reading)
		if (failure_output === '') failure_output = taken.failure_output
	}

	if (failure_output !== '') process.stderr.write(failure_output)

	return { target: target.name, caches: bench_targets.clearable_caches(target), readings }
}

// **The last thing a run says about itself: is the tree back as it was.** Every cache cleared here
// is rewritten by the warm run that follows it, so an absent one afterwards means a check never got
// far enough to write it — worth a note rather than silence, since the next `josh gate` then pays
// the cold cost this command just measured.
function residue_notes(samples: ReadonlyArray<BenchSample>, root: string): Array<string> {
	const missing = samples
		.flatMap((sample) => sample.caches)
		.filter((cache) => !existsSync(cache_path(root, cache)))

	if (missing.length === 0) return []

	return [`caches not rebuilt by the warm run: ${[...new Set(missing)].join(', ')}`]
}

async function measure_targets(
	targets: ReadonlyArray<BenchTarget>,
	repetitions: number,
	root: string,
): Promise<ReadonlyArray<BenchSample>> {
	const samples: Array<BenchSample> = []

	for (const target of targets) {
		samples.push(await measure_target(target, repetitions, root))
	}

	return samples
}

// `take_reading` is exported so the guard's **call site** can be tested rather than only the
// predicate beside it: the defect this feature's review found was a guard checked once at start-up,
// and a suite that exercised `bench-guard.ts` alone would have stayed green through it.
const bench_run = { clear_caches, measure_target, measure_targets, residue_notes, take_reading }

export { bench_run }
