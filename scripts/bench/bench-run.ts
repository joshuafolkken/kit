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

interface Taken {
	reading: BenchReading
	failure_output: string
}

// One cycle, and the first failing transcript it produced. **The guard is asked here rather than once
// at start-up**: a default run is minutes long and clears a target's caches before every cold reading,
// so a gate started by a hook after the first check would otherwise be walked straight into.
async function take_reading(target: BenchTarget, root: string): Promise<Taken> {
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

// One cycle, or `undefined` where a gate had started on this tree before it could begin. **The
// refusal is caught here rather than at the top of the command** (joshuafolkken/kit#1369): the
// readings already taken were taken before that gate existed, and the abort's rationale — a reading
// taken beside a gate measures neither of them — does not reach backwards to them.
async function take_reading_or_stop(target: BenchTarget, root: string): Promise<Taken | undefined> {
	try {
		return await take_reading(target, root)
	} catch (error) {
		if (!bench_guard.is_gate_running_error(error)) throw error

		return undefined
	}
}

interface TargetReadings {
	readings: ReadonlyArray<BenchReading>
	failure_output: string
	is_interrupted: boolean
}

// The first failing transcript of the cycles that ran, or none. Collected and picked afterwards
// rather than assigned inside the loop, so the loop keeps one decision in it — whether a gate stopped
// the run — instead of two.
function taken_readings(
	readings: ReadonlyArray<BenchReading>,
	outputs: ReadonlyArray<string>,
	is_interrupted: boolean,
): TargetReadings {
	return {
		readings,
		failure_output: outputs.find((output) => output !== '') ?? '',
		is_interrupted,
	}
}

// A target's cycles, stopping at the first one a gate refused and keeping every reading taken before
// it.
async function take_readings(
	target: BenchTarget,
	repetitions: number,
	root: string,
): Promise<TargetReadings> {
	const readings: Array<BenchReading> = []
	const outputs: Array<string> = []

	for (let round = 0; round < repetitions; round += 1) {
		const taken = await take_reading_or_stop(target, root)

		if (taken === undefined) return taken_readings(readings, outputs, true)

		readings.push(taken.reading)
		outputs.push(taken.failure_output)
	}

	return taken_readings(readings, outputs, false)
}

interface TargetMeasurement {
	sample: BenchSample
	is_interrupted: boolean
}

// **A target stopped before its first cycle cleared nothing, so it declares nothing.** The guard is
// asked ahead of `clear_caches`, which is what makes "took a reading" the same question as "removed a
// cache" — and it is the rule `bench-interrupt.ts` applies to a target the run never reached. Without
// it, two rows that both render `not measured` would disagree in `--json` about what was removed.
function cleared_caches(
	target: BenchTarget,
	readings: ReadonlyArray<BenchReading>,
): ReadonlyArray<string> {
	if (readings.length === 0) return []

	return bench_targets.clearable_caches(target)
}

// **A failed reading shows why it failed, once.** Its figure is excluded from the row, so without any
// transcript the user is left with `2 reading(s) exited non-zero, excluded` and nothing to act on —
// and the usual cause is a genuinely red check that wants fixing before anything is measured at all.
async function measure_target(
	target: BenchTarget,
	repetitions: number,
	root: string,
): Promise<TargetMeasurement> {
	const taken = await take_readings(target, repetitions, root)

	if (taken.failure_output !== '') process.stderr.write(taken.failure_output)

	return {
		sample: {
			target: target.name,
			caches: cleared_caches(target, taken.readings),
			readings: taken.readings,
		},
		is_interrupted: taken.is_interrupted,
	}
}

// **The last thing a run says about itself: is the tree back as it was.** Every cache cleared here
// is rewritten by the warm run that follows it, so an absent one afterwards means a check never got
// far enough to write it — worth a note rather than silence, since the next `josh gate` then pays
// the cold cost this command just measured.
//
// **A target that took no reading cleared nothing**, so it is left out rather than reported as a
// cache the warm run failed to rebuild: after joshuafolkken/kit#1369 an interrupted run carries such
// a sample, and without the filter it would accuse a warm run that never started.
function residue_notes(samples: ReadonlyArray<BenchSample>, root: string): Array<string> {
	const missing = samples
		.filter((sample) => sample.readings.length > 0)
		.flatMap((sample) => sample.caches)
		.filter((cache) => !existsSync(cache_path(root, cache)))

	if (missing.length === 0) return []

	return [`caches not rebuilt by the warm run: ${[...new Set(missing)].join(', ')}`]
}

interface RunMeasurement {
	samples: ReadonlyArray<BenchSample>
	is_interrupted: boolean
}

// **An interruption ends the run and keeps what it has.** The targets after it are not attempted —
// the gate is still holding the caches — and `bench-interrupt.ts` is what turns the ones never
// reached into rows saying so.
async function measure_targets(
	targets: ReadonlyArray<BenchTarget>,
	repetitions: number,
	root: string,
): Promise<RunMeasurement> {
	const samples: Array<BenchSample> = []

	for (const target of targets) {
		const taken = await measure_target(target, repetitions, root)

		samples.push(taken.sample)

		if (taken.is_interrupted) return { samples, is_interrupted: true }
	}

	return { samples, is_interrupted: false }
}

// `take_reading` is exported so the guard's **call site** can be tested rather than only the
// predicate beside it: the defect this feature's review found was a guard checked once at start-up,
// and a suite that exercised `bench-guard.ts` alone would have stayed green through it.
// `take_readings` joins it for the same reason one level up — the refusal is now caught there, and
// what a suite has to see is that the readings taken before it survive.
const bench_run = {
	clear_caches,
	measure_target,
	measure_targets,
	residue_notes,
	take_reading,
	take_readings,
}

export { bench_run }
