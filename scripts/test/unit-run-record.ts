import { appendFileSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { core_budget } from '#scripts/gate/core-budget'
import { machine_capacity, type MachineReading } from '#scripts/gate/machine-capacity'
import { durable_state } from '#scripts/josh/durable-state'
import { durable_state_root } from '#scripts/josh/durable-state-root'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_stats } from '#scripts/lane/lane-stats'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { unit_run_marker, type RunMarker } from './unit-run-marker'
import { unit_worker_share, type FreeCapacity, type UnitClaim } from './unit-worker-share'

// **One line per whole-suite run, saying what sized it and what it ran beside** (joshuafolkken/kit#9109).
// The same 3634-file suite took 2821 s in one lane and 975 s an hour later, and neither log said how
// many workers it opened, which bound chose that number, how long it waited for the core budget or
// what else was running — so the slow run could not be explained afterwards, and a green run three
// times slower than usual told nobody. The line answers each of those, and compares the duration with
// the median of the recent runs this repository recorded.
//
// **A slow run is said, never failed.** The duration depends on the machine as much as on the tree,
// and a red unit check over load would block a sound change; the line names the figures to read instead.

// Which bound decided the worker count. `flag` is a count the caller typed — the gate passes its own,
// sized and admitted there (`gate-run-steps.ts`); `default` is vitest's own choice, left in place.
type SizingBound = 'flag' | 'default' | 'share' | 'cores' | 'memory' | 'claim'

interface SizingStage {
	bound: SizingBound
	workers: number | undefined
}

interface Sizing {
	bound: SizingBound
	workers: number | undefined
}

interface RunKinds {
	lane: number
	outside: number
	unknown: number
}

interface RunFacts {
	sizing: Sizing
	waited_ms: number | undefined
	runs: RunKinds
	available_cores: number
	machine: MachineReading
	duration_ms: number
}

const history_entry_schema = z.object({ duration_ms: z.number(), at: z.number() })

type HistoryEntry = z.infer<typeof history_entry_schema>

const MS_PER_SECOND = 1000
const SLOW_RATIO = 2
const RATIO_DIGITS = 2
const HISTORY_RUNS = 20
const HISTORY_KEY = 'whole-suite'
const HISTORY_SUFFIX = '.jsonl'
const WORKER_FLAG_PATTERN = /^--max-?workers=(?<count>\d+)$/iu

// The last stage that changed the count is the one that decided it; one that left it as it was did not.
function deciding_bound(stages: ReadonlyArray<SizingStage>): Sizing {
	let decided: Sizing = { bound: 'default', workers: undefined }

	for (const stage of stages) {
		if (stage.workers !== decided.workers) decided = { bound: stage.bound, workers: stage.workers }
	}

	return decided
}

interface SizingInputs {
	share: number | undefined
	free: FreeCapacity
	claim: UnitClaim | undefined
	available_cores: number
}

// The share capped to the free cores, then the free memory, then the claim — `cap_to_capacity` and
// `cap_to_claim` taken one bound at a time, so the record can say which one decided the count.
function bounded_sizing(inputs: SizingInputs): Sizing {
	const { share, free, claim, available_cores } = inputs
	const cores = unit_worker_share.cap_to_free(share, free.cores, available_cores)
	const memory = unit_worker_share.cap_to_free(cores, free.memory_workers, available_cores)

	return deciding_bound([
		{ bound: 'share', workers: share },
		{ bound: 'cores', workers: cores },
		{ bound: 'memory', workers: memory },
		{ bound: 'claim', workers: unit_worker_share.cap_to_claim(memory, claim) },
	])
}

function typed_sizing(vitest_arguments: ReadonlyArray<string>): Sizing {
	const count = vitest_arguments
		.map((argument) => WORKER_FLAG_PATTERN.exec(argument)?.groups?.['count'])
		.find((value) => value !== undefined)

	return { bound: 'flag', workers: count === undefined ? undefined : Number(count) }
}

// A whole-suite run is `vitest run` with nothing but flags after it; a filtered or related run is a
// different measurement and is not compared with the suite's median.
function is_whole_suite(vitest_arguments: ReadonlyArray<string>): boolean {
	const [command, ...rest] = vitest_arguments

	return command === 'run' && rest.every((argument) => argument.startsWith('-'))
}

function kind_of(marker: RunMarker): keyof RunKinds {
	if (marker.checkout === undefined) return 'unknown'

	return lane_paths.lane_issue_of(marker.checkout) === undefined ? 'outside' : 'lane'
}

function run_kinds(markers: ReadonlyArray<RunMarker>): RunKinds {
	const kinds: RunKinds = { lane: 0, outside: 0, unknown: 0 }

	for (const marker of markers) kinds[kind_of(marker)] += 1

	return kinds
}

// The parent's wait for the core budget, read from the claim this run was admitted on.
function claim_wait_ms(): number | undefined {
	const claim = core_budget.held_unit_claim()

	if (claim?.admitted_at === undefined) return undefined

	return claim.admitted_at - claim.claimed_at
}

function seconds(ms: number): string {
	return `${(ms / MS_PER_SECOND).toFixed(1)}s`
}

function or_unread(value: number | undefined, render: (known: number) => string): string {
	return value === undefined ? 'unread' : render(value)
}

function machine_part(facts: RunFacts): string {
	const { busy_cores, available_mb, run_queue } = facts.machine
	const free = or_unread(busy_cores, (busy) => (facts.available_cores - busy).toFixed(1))
	const memory = or_unread(available_mb, (mb) => `${String(Math.round(mb))} MB`)
	const load = or_unread(run_queue, (queue) => queue.toFixed(1))

	return `free ${free} of ${String(facts.available_cores)} cores · ${memory} free · load ${load}`
}

function median_part(duration_ms: number, median_ms: number | undefined): string {
	if (median_ms === undefined || median_ms <= 0) return 'no median yet'

	const ratio = duration_ms / median_ms
	const slow =
		ratio > SLOW_RATIO
			? ` — slow: over ${String(SLOW_RATIO)}× the median; read the runs in flight, the wait and the free memory above for why`
			: ''

	return `${ratio.toFixed(RATIO_DIGITS)}× the median ${seconds(median_ms)}${slow}`
}

function record_line(facts: RunFacts, median_ms: number | undefined): string {
	const { sizing, runs } = facts
	const workers = sizing.workers === undefined ? 'vitest default' : String(sizing.workers)

	return [
		`test:unit run: ${workers} workers (bound: ${sizing.bound})`,
		`waited ${or_unread(facts.waited_ms, seconds)}`,
		`${String(runs.lane + runs.outside + runs.unknown)} runs in flight (lane ${String(runs.lane)}, outside ${String(runs.outside)}, unknown ${String(runs.unknown)})`,
		machine_part(facts),
		`${seconds(facts.duration_ms)}, ${median_part(facts.duration_ms, median_ms)}`,
	].join(' · ')
}

function history_path(): string {
	return durable_state.path(durable_state_root.PREFIX.UNIT_RUNS, HISTORY_KEY, HISTORY_SUFFIX)
}

function parse_entry(line: string): Array<HistoryEntry> {
	const parsed = history_entry_schema.safeParse(json_value.parse_or_undefined(line))

	return parsed.success ? [parsed.data] : []
}

// The median of the recent whole-suite durations; a missing or unreadable history has none.
function recent_median(target: string): number | undefined {
	try {
		const lines = readFileSync(target, 'utf8').split('\n').filter(Boolean).slice(-HISTORY_RUNS)

		return lane_stats.median(
			lines.flatMap((line) => parse_entry(line)).map((entry) => entry.duration_ms),
		)
	} catch {
		return undefined
	}
}

// A history that cannot be written costs the next run its comparison, never this run its result.
function remember(target: string, duration_ms: number): void {
	try {
		appendFileSync(target, `${JSON.stringify({ duration_ms, at: Date.now() })}\n`)
	} catch {
		/* the record is a reading aid, not part of the run */
	}
}

async function with_record(
	vitest_arguments: ReadonlyArray<string>,
	sizing: Sizing,
	run: () => Promise<number>,
): Promise<number> {
	if (!is_whole_suite(vitest_arguments)) return await run()

	const machine = await machine_capacity.read_machine()
	const runs = run_kinds(unit_run_marker.live_markers())
	const started = Date.now()
	const exit_code = await run()
	const facts: RunFacts = {
		sizing,
		waited_ms: claim_wait_ms(),
		runs,
		available_cores: availableParallelism(),
		machine,
		duration_ms: Date.now() - started,
	}
	const target = history_path()

	console.info(record_line(facts, recent_median(target)))
	remember(target, facts.duration_ms)

	return exit_code
}

const unit_run_record = {
	bounded_sizing,
	deciding_bound,
	is_whole_suite,
	recent_median,
	record_line,
	remember,
	run_kinds,
	typed_sizing,
	with_record,
}

export type { RunFacts, RunKinds, Sizing, SizingBound, SizingStage }
export { unit_run_record }
