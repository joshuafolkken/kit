import { availableParallelism } from 'node:os'
import { stamp_file } from '#scripts/josh/stamp-file'
import { unit_run_marker } from './unit-run-marker'

// How wide one vitest run may fan out when it is not the only one on the machine.
//
// **`gate-plan.ts` sizes the unit suite from the core count and nothing else**, so six lanes running
// `josh gate` at once each concluded "11 cores, take 7 workers" and put 42 workers on 11 cores. The
// pre-push hook once passed no cap at all; it now runs the suite through `test_unit_guard.run_guarded_unit`,
// the same guard `josh test:unit` uses, so the share below applies there too.
// Measured on the machine this was found on — load average 14.97 in the field, and 209 in a deliberate
// reproduction of six concurrent suites, against 22 once the share below was applied.
//
// **What it fixes, and what it does not.** Six concurrent copies of the full suite produced ten
// `Test timed out in 10000ms` failures across six runs; at the share this module hands out, the same
// six runs produced **none**. It is the *second* multiplicand of those timeouts — the first
// was a live `git fetch` inside two test files, which is fixed in `test-network-guard.ts` and its
// callers, and which no worker count would have repaired: that one failed on an idle machine at one
// worker.
//
// **The division activates only under concurrency.** One run in flight — every solo run, CI included
// — gets exactly the number the gate and the hook produced before this module existed, so a quiet
// machine behaves bit for bit as it did and only the condition that was measured broken changes.
//
// **The run markers and their division of the machine are `unit-run-marker.ts`**, the part the vitest
// config imports (joshuafolkken/kit#4572); the capacity and claim bounds and the flag handling are here.
const { MIN_WORKERS, NESTED_KEY, NESTED_VALUE, SOLO_RUNS } = unit_run_marker
const { is_nested_run, live_run_count, mark_run_started, marker_path, resolve_unit_workers } =
	unit_run_marker

// Vitest's own flag, in both spellings its CLI accepts — it normalizes `--max-workers` to the same
// option, so a run that recognized only one of them would replace a number the caller typed with the
// share and contradict the promise below. The camel-case one is what gets written.
const WORKER_FLAG = '--maxWorkers'
const WORKER_FLAGS: ReadonlyArray<string> = [WORKER_FLAG, '--max-workers']
// The core vitest's own process — the pool, the reporter and Vite's transforms — keeps busy beside its
// workers (joshuafolkken/kit#4362). A direct run's claim holds it above its worker count.
const MAIN_PROCESS_CORES = 1

// **The run count divides the machine; the free cores bound what that division hands out.** The
// share counts only unit runs, so load from outside the core budget's ledger — Claude sessions, other
// tools — went unseen: 22 of 38 ledger samples at a load average of 20 or more had vitest as their
// heaviest process, one at 381% over 30 processes. `free_cores` is `free-cores.ts`'s reading, the
// cores less that outside load. `undefined` — a CI runner, a CPU quota — and a reading at or above
// the ceiling both leave `workers` as it was, so an unread or quiet machine changes nothing.
function cap_to_free(
	workers: number | undefined,
	free_cores: number | undefined,
	available_cores: number,
): number | undefined {
	if (free_cores === undefined || free_cores >= (workers ?? available_cores)) return workers

	return Math.max(MIN_WORKERS, Math.floor(free_cores))
}

// What the machine has free for this run's workers, both from `free-cores.ts`'s one reading: the free
// cores, and the workers the free memory holds. Either is `undefined` where it could not be read.
interface FreeCapacity {
	cores: number | undefined
	memory_workers: number | undefined
}

const UNREAD_CAPACITY: FreeCapacity = { cores: undefined, memory_workers: undefined }

// **The free memory bounds the share as the free cores do** (joshuafolkken/kit#4528). Lanes running
// their suites at once each sized workers from the cores alone, so their workers' memory piled up
// until the batch stopped opening lanes. Both bounds go through `cap_to_free`, so an unread one leaves
// the share as it was.
function cap_to_capacity(
	workers: number | undefined,
	free: FreeCapacity,
	available_cores: number,
): number | undefined {
	const core_capped = cap_to_free(workers, free.cores, available_cores)

	return cap_to_free(core_capped, free.memory_workers, available_cores)
}

// The core-budget claim a unit run holds: the weight it reserved, and the narrower one it was admitted
// at past the wait cap.
interface UnitClaim {
	weight: number
	granted?: number | undefined
}

// **The share never exceeds the claim the run was admitted on** (joshuafolkken/kit#4235). The share is
// read after admission, when fewer runs may be in flight than when the weight was sized, and a share
// wider than the claim puts workers on the machine the ledger does not hold. The claim bounds a solo
// share too: vitest's own choice is one worker per core but one, wider than any weight the ledger
// reserves for a unit run, so leaving it in place would open workers no claim holds. The claim holds
// vitest's own process as well, so its workers are the claim less that core.
function cap_to_claim(share: number | undefined, claim: UnitClaim | undefined): number | undefined {
	if (claim === undefined) return share

	const bound = Math.max(MIN_WORKERS, (claim.granted ?? claim.weight) - MAIN_PROCESS_CORES)

	return Math.min(share ?? bound, bound)
}

// The share this run may take, read from the machine. Separate from `resolve_unit_workers` so that
// one stays a pure function of two numbers and every test of it can pass them.
//
// **A nested run is already counted, and adding one for it would be wrong rather than cautious.**
// Inside `josh gate` the marker was written by the parent before this process started, so `+ 1` here
// would count one run twice — and on a machine the gate leaves uncapped, a four-core CI runner among
// them, that alone would halve a solo run nothing was sharing.
function current_share(
	available_cores: number = availableParallelism(),
	live_runs: number = live_run_count(),
	free: FreeCapacity = UNREAD_CAPACITY,
): number | undefined {
	const own_run = is_nested_run() ? 0 : SOLO_RUNS
	const share = resolve_unit_workers(available_cores, live_runs + own_run)

	return cap_to_capacity(share, free, available_cores)
}

function is_worker_flag(argument: string): boolean {
	return WORKER_FLAGS.some((flag) => argument === flag || argument.startsWith(`${flag}=`))
}

// **A number the caller typed is never overridden.** `pnpm josh test:unit --maxWorkers=4` is a person
// saying what they want, and `josh gate` passes its own cap for a reason this module cannot see — the
// three sibling checks it has to leave cores for. Both already account for the share: the gate through
// `gate-plan.ts`, which is handed the same count.
//
// **`share` is required rather than defaulted to `current_share()`.** A default reading the machine
// would make this function's own answer depend on what happened to be running while it was asked, and
// `f(args, undefined)` takes the default rather than the value — so the case that matters most, "this
// run is alone", would be the one case no test could express.
function has_worker_flag(vitest_arguments: ReadonlyArray<string>): boolean {
	return vitest_arguments.some((argument) => is_worker_flag(argument))
}

function worker_arguments(
	vitest_arguments: ReadonlyArray<string>,
	share: number | undefined,
): Array<string> {
	if (share === undefined || has_worker_flag(vitest_arguments)) return []

	return [`${WORKER_FLAG}=${String(share)}`]
}

// `finally`, so a suite that threw still clears its marker — and so does the nested branch, which
// restores nothing because it wrote nothing.
async function with_run_marker<T>(run: () => Promise<T>): Promise<T> {
	if (is_nested_run()) return await run()

	const target = marker_path()

	mark_run_started(target)
	process.env[NESTED_KEY] = NESTED_VALUE

	try {
		return await run()
	} finally {
		// Emptied rather than deleted: this project bans deleting a computed key, and an empty string is
		// not `NESTED_VALUE`, so `is_nested_run` reads it as cleared either way.
		process.env[NESTED_KEY] = ''
		stamp_file.remove_stamp(target)
	}
}

const unit_worker_share = {
	...unit_run_marker,
	MAIN_PROCESS_CORES,
	cap_to_capacity,
	cap_to_claim,
	cap_to_free,
	current_share,
	has_worker_flag,
	with_run_marker,
	worker_arguments,
}

export type { FreeCapacity, UnitClaim }
export { unit_worker_share }
