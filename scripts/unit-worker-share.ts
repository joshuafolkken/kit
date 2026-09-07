import { readdirSync } from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { stamp_file } from './josh/stamp-file'

// How wide one vitest run may fan out when it is not the only one on the machine
// (joshuafolkken/kit#1515).
//
// **`gate-plan.ts` sizes the unit suite from the core count and nothing else**, so six lanes running
// `josh gate` at once each concluded "11 cores, take 7 workers" and put 42 workers on 11 cores. The
// pre-push hook is worse: it passes no cap at all, so vitest opens one worker per core there. Measured
// on the machine this was found on — load average 14.97 in the field, and 209 in a deliberate
// reproduction of six concurrent suites, against 22 once the share below was applied.
//
// **What it fixes, and what it does not.** Six concurrent copies of the full suite produced ten
// `Test timed out in 10000ms` failures across six runs; at the share this module hands out, the same
// six runs produced **none**. It is the *second* multiplicand of joshuafolkken/kit#1515 — the first
// was a live `git fetch` inside two test files, which is fixed in `test-network-guard.ts` and its
// callers, and which no worker count would have repaired: that one failed on an idle machine at one
// worker.
//
// **The division activates only under concurrency.** One run in flight — every solo run, CI included
// — gets exactly the number the gate and the hook produced before this module existed, so a quiet
// machine behaves bit for bit as it did and only the condition that was measured broken changes.

// A record that means something only while it exists, in the shape `stamp-file.ts` already keeps for
// the in-flight gate marker. Keyed by pid rather than by checkout: `josh gate`'s unit step and a
// `josh test:related` can be in flight in one checkout at once, and both of them are load.
const RUN_PREFIX = 'josh-unit-running-'
// Vitest's own flag, in both spellings its CLI accepts — it normalizes `--max-workers` to the same
// option, so a run that recognized only one of them would replace a number the caller typed with the
// share and contradict the promise below. The camel-case one is what gets written.
const WORKER_FLAG = '--maxWorkers'
const WORKER_FLAGS: ReadonlyArray<string> = [WORKER_FLAG, '--max-workers']
// Never below one: a share of zero would run no test at all and report the suite green.
const MIN_WORKERS = 1
// One run in flight is this run alone, which is the case that changes nothing.
const SOLO_RUNS = 1
// `process.kill(pid, 0)` tests for a process without signalling it.
const LIVENESS_PROBE = 0
// Below this a pid is not a process: `0` is the caller's own process group and anything negative is
// another group. See `is_running`.
const LOWEST_REAL_PID = 1

const run_marker_schema = z.object({ pid: z.number() })

function marker_path(pid: number = process.pid): string {
	return stamp_file.stamp_path(RUN_PREFIX, String(pid))
}

// **A marker is evidence, and the pid is the test.** A run killed outright leaves its file behind, and
// a count that trusted the file alone would hold every later run down to one worker for good — the
// failure mode `run-hold.ts` answers with an expiry, which cannot be sized here because a unit suite
// under six-way load already takes minutes. The process that writes this marker is the long-lived one,
// so unlike a `run:hold` record its pid is a liveness test rather than a note for the reader.
// **A pid that is not positive is never a live run, and the check is not cosmetic.** `process.kill(0,
// …)` addresses the caller's own process group rather than a process, and a negative pid addresses
// another group — so a marker carrying either, from a truncated write or a hand-edited file, would
// answer "alive" forever and hold every run on the machine at one worker.
function is_running(pid: number): boolean {
	if (pid < LOWEST_REAL_PID) return false

	try {
		process.kill(pid, LIVENESS_PROBE)

		return true
	} catch {
		return false
	}
}

function read_marker_pid(source: string): number | undefined {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		const parsed = run_marker_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data.pid : undefined
	} catch {
		return undefined
	}
}

// An unreadable temp directory answers "no other run", which is the direction that leaves behavior
// as it was rather than throttling a run on a guess. Unlike the network guard, being wrong here costs
// wall time and never a false result.
function marker_files(directory: string = tmpdir()): Array<string> {
	try {
		return readdirSync(directory).filter((name) => name.startsWith(RUN_PREFIX))
	} catch {
		return []
	}
}

// **A marker whose process is gone is removed, not merely skipped.** Skipping it is correct only until
// the operating system reissues that pid to something else, which on a machine left running for days
// it will — and from then on the phantom is counted as a live run for good, with every solo run held
// at one worker and `josh gate` announcing lanes that do not exist. `finally` in `with_run_marker`
// cannot prevent the leak, because the interrupt that produces it (Ctrl-C reaching the whole foreground
// group) does not unwind. Sweeping on read is what bounds it: the first later run collects it.
function sweep_marker(source: string): void {
	try {
		stamp_file.remove_stamp(source)
	} catch {
		/* not ours to remove; counting it out is the whole requirement */
	}
}

// **Only a marker that parsed to a dead pid is swept, and the unlink still cannot throw.** A marker
// this account may not read — another user's file on a sticky `/tmp` — is `undefined` here, and
// deleting on that answer would raise `EPERM` from a path with no `catch` between it and
// `announce_gate_plan`: an unreadable file belonging to somebody else would abort the gate outright,
// which is worse than the leak this sweep exists for. Unreadable therefore counts as not-live and is
// left alone, exactly as it was before the sweep existed.
function is_marker_live(source: string): boolean {
	const pid = read_marker_pid(source)

	if (pid === undefined) return false
	if (is_running(pid)) return true

	sweep_marker(source)

	return false
}

// Every marker in the temp directory whose process is still alive. This run's own is deliberately not
// among them: both callers count *before* writing theirs, so the `+ 1` at the call site adds it.
function live_run_count(directory: string = tmpdir()): number {
	return marker_files(directory).filter((name) => is_marker_live(path.join(directory, name))).length
}

// **The gate claims its place before its unit step exists, and the child must not claim a second
// one.** `josh gate` counts the runs in flight and then spawns `josh test:unit`, so without this the
// marker appears a second or so after the count that needed it — and two lanes launched together, the
// shape `epicrun` produces, both read "nothing else is running" and both take the whole machine. The
// gate therefore marks itself around the whole run and passes this down through the environment; the
// guard inside the child sees it and marks nothing, because the two processes are one run.
const NESTED_KEY = 'JOSH_UNIT_RUN_MARKED'
const NESTED_VALUE = '1'

function is_nested_run(): boolean {
	return process.env[NESTED_KEY] === NESTED_VALUE
}

// **`undefined` at one run means "leave the choice where it was".** The gate then applies its own
// core reservation and the hook passes no flag at all, which is what both did before this existed.
function resolve_unit_workers(available_cores: number, runs: number): number | undefined {
	if (runs <= SOLO_RUNS) return undefined

	return Math.max(MIN_WORKERS, Math.floor(available_cores / runs))
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
): number | undefined {
	const own_run = is_nested_run() ? 0 : SOLO_RUNS

	return resolve_unit_workers(available_cores, live_runs + own_run)
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
function worker_arguments(
	vitest_arguments: ReadonlyArray<string>,
	share: number | undefined,
): Array<string> {
	if (share === undefined) return []
	if (vitest_arguments.some((argument) => is_worker_flag(argument))) return []

	return [`${WORKER_FLAG}=${String(share)}`]
}

// **The write failing is not a reason to fail the run.** A marker that could not be written costs the
// next run a wider share than it should have — the behavior that was there before — while a thrown
// error here would fail a unit suite over bookkeeping.
function mark_run_started(target: string): void {
	try {
		stamp_file.write_stamp(target, { pid: process.pid })
	} catch {
		/* a missing marker costs a wide share, never a wrong result */
	}
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
	MIN_WORKERS,
	NESTED_KEY,
	RUN_PREFIX,
	SOLO_RUNS,
	WORKER_FLAG,
	current_share,
	is_running,
	live_run_count,
	marker_files,
	marker_path,
	read_marker_pid,
	resolve_unit_workers,
	with_run_marker,
	worker_arguments,
}

export { unit_worker_share }
