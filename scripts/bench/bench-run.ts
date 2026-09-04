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

// **A failed reading shows why it failed.** Its figure is excluded from the row, so without this the
// user is left with `2 reading(s) exited non-zero, excluded` and nothing to act on — and the usual
// cause is a genuinely red check that wants fixing before anything is measured at all.
async function run_target(
	target: BenchTarget,
): Promise<{ elapsed_ms: number; is_failed: boolean }> {
	const result = await buffered_process.run_buffered_process([JOSH, target.name, ...target.flags])
	const is_failed = buffered_process.is_process_failed(result)

	if (is_failed && result.output) process.stderr.write(result.output)

	return { elapsed_ms: result.elapsed_ms, is_failed }
}

async function take_reading(target: BenchTarget, root: string): Promise<BenchReading> {
	bench_guard.assert_no_gate()
	clear_caches(target, root)

	const cold = await run_target(target)
	const warm = await run_target(target)

	return {
		cold_ms: cold.elapsed_ms,
		warm_ms: warm.elapsed_ms,
		is_failed: cold.is_failed || warm.is_failed,
	}
}

async function measure_target(
	target: BenchTarget,
	repetitions: number,
	root: string,
): Promise<BenchSample> {
	const readings: Array<BenchReading> = []

	for (let round = 0; round < repetitions; round += 1) {
		readings.push(await take_reading(target, root))
	}

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

const bench_run = { clear_caches, measure_target, measure_targets, residue_notes }

export { bench_run }
