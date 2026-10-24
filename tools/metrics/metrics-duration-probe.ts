import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { file_reader } from '#scripts/lib/read-file'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { run_carry } from '#scripts/run/carry/run-carry'
import { metrics_duration_load } from './metrics-duration-load'
import { metrics_durations, type Durations, type DurationVerdict } from './metrics-durations'

// The I/O around `metrics-durations.ts`: read the gate and unit durations
// off the lane ledger, time the two startups, and hold them to this machine's baseline.
//
// **The gate is never timed here.** `josh gate` already appends its duration and its unit suite's to
// the lane ledger, so these are read back rather than measured twice — which is also why they are the
// *previous* gates': `josh metrics` runs inside the gate whose own duration is not known yet.
//
// **A startup is the fastest of several runs**, the reading least disturbed by whatever else the
// machine is doing — the gate runs this beside its unit check.

const SAMPLES = 5
const BASELINE_FILE = 'metrics-durations.json'
const LEGACY_BASELINE_FILE = 'josh-metrics-durations.json'
const JOSH_COMMAND: ReadonlyArray<string> = [
	'node_modules/.bin/tsx',
	'scripts/josh/josh.ts',
	'--help',
]
const GUARD_COMMAND: ReadonlyArray<string> = ['sh', 'scripts/hooks/run-hook.sh', 'pretool-guard']
// The smallest tool call the hook can be handed: it allows it without reading anything else.
const HOOK_INPUT = '{}'
const FAILURE_EXIT_CODE = 1

// The durations and whether the machine was busy inside the gates they were read from.
interface Measurement {
	durations: Durations
	is_busy: boolean
}

function is_timed_out(result: SpawnSyncReturns<Buffer>): boolean {
	const { error } = result

	return error !== undefined && 'code' in error && error.code === 'ETIMEDOUT'
}

// A run killed at the timeout is held at the timeout, a floor: the slowdown this exists to catch must
// fail the check, not read as unmeasured.
function time_once(command: ReadonlyArray<string>, root: string): number | undefined {
	const [program = '', ...args] = command
	const started_at = performance.now()
	const result = spawnSync(program, args, {
		cwd: root,
		input: HOOK_INPUT,
		stdio: ['pipe', 'ignore', 'ignore'],
		timeout: PROBE_TIMEOUT_MS,
	})
	const elapsed_ms = performance.now() - started_at

	if (is_timed_out(result)) return Math.max(elapsed_ms, PROBE_TIMEOUT_MS)

	return result.status === 0 ? elapsed_ms : undefined
}

// `undefined` when any run failed: a startup that did not finish has no duration to hold.
function fastest(command: ReadonlyArray<string>, root: string): number | undefined {
	const timings = Array.from({ length: SAMPLES }, () => time_once(command, root))

	return timings.includes(undefined) ? undefined : Math.min(...timings.map(Number))
}

function time_startups(root: string): Durations {
	return { josh_startup: fastest(JOSH_COMMAND, root), guard_startup: fastest(GUARD_COMMAND, root) }
}

async function read_ledger(): Promise<ReadonlyArray<LedgerEntry>> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? [] : lane_ledger.read_entries(ledger)
}

async function measure(root: string, is_startup_timed: boolean): Promise<Measurement> {
	const entries = await read_ledger()
	const recorded = metrics_durations.from_ledger(entries)
	const is_busy = metrics_duration_load.is_busy(entries, availableParallelism())
	const durations = is_startup_timed ? { ...recorded, ...time_startups(root) } : recorded

	return { durations, is_busy }
}

// The baseline kept at the common git directory's root before joshuafolkken/kit#4653 is carried into the
// josh state directory rather than dropped. Where the root is read-only it is copied instead; the
// leftover is never read again. A gate of another lane that moved it first — even between the check and
// the copy — leaves nothing to copy.
function copy_if_present(source: string, target: string): void {
	try {
		copyFileSync(source, target)
	} catch (error) {
		if (!file_reader.is_absent(error)) throw error
	}
}

function adopt_legacy_baseline(repository: string, file: string): void {
	const legacy = path.join(repository, LEGACY_BASELINE_FILE)

	if (existsSync(file) || !existsSync(legacy)) return
	mkdirSync(path.dirname(file), { recursive: true })

	try {
		renameSync(legacy, file)
	} catch {
		copy_if_present(legacy, file)
	}
}

// In the common git directory's josh state: one file per clone, so per machine, shared by every lane of
// it and never committed.
async function baseline_path(): Promise<string | undefined> {
	const repository = await run_carry.repository_directory()

	if (repository === undefined) return undefined
	const file = path.join(repository, git_common_directory.STATE_DIRECTORY, BASELINE_FILE)

	adopt_legacy_baseline(repository, file)

	return file
}

function read_baseline(file: string): Durations {
	const text = file_reader.read_if_readable(file)

	return text === undefined ? {} : metrics_durations.parse_baseline(text)
}

function write_baseline(file: string, durations: Durations): void {
	mkdirSync(path.dirname(file), { recursive: true })
	writeFileSync(file, metrics_durations.baseline_text(durations))
}

// `--accept` replaces what it measured and keeps the rest: a raise taken with no solo gate in the
// ledger yet must not drop the gate's bar.
function accept(file: string, durations: Durations): void {
	write_baseline(file, metrics_durations.overlay(read_baseline(file), durations))
}

// A gate or unit slowdown measured while the machine was busy warns and passes; any other fails.
function report_regressions(verdict: DurationVerdict, file: string, is_busy: boolean): number {
	const { warned, failed } = metrics_duration_load.split(verdict.regressions, is_busy)

	if (warned.length > 0) {
		process.stderr.write(`${metrics_duration_load.render_warning(warned, file)}\n`)
	}

	if (failed.length === 0) return 0
	process.stderr.write(`${metrics_durations.render_regressions(failed, file)}\n`)

	return FAILURE_EXIT_CODE
}

function check(file: string, measurement: Measurement): number {
	const verdict = metrics_durations.compare(read_baseline(file), measurement.durations)

	if (verdict.regressions.length > 0) return report_regressions(verdict, file, measurement.is_busy)
	if (verdict.is_extended) write_baseline(file, verdict.baseline)

	return 0
}

const metrics_duration_probe = {
	accept,
	baseline_path,
	check,
	measure,
}

export type { Measurement }
export { metrics_duration_probe }
