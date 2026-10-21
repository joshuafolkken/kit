import { process_identity } from '#scripts/josh/process-identity'
import { lane_ledger, type GateCheckRecord } from '#scripts/lane/lane-ledger'
import { related_scope } from '#scripts/test/test-related-scope'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import { gate_plan } from './gate-plan'
import { gate_report, type GateStepResult } from './gate-report'
import { machine_capacity } from './machine-capacity'

// A finished gate's line in the lane ledger: its duration, its verdict, its
// unit suite's duration, and the load it ran beside, so `josh metrics`
// compares only gates the machine was quiet for. Another gate's span is not the only load: another
// lane's lint, related tests or `ship` doubled a solo gate's duration within minutes.
//
// **The machine is read where none of the gate's own checks runs — before the first starts and after
// the last ends.** The load average cannot tell the two apart: a solo gate started at 4 on the 11-core
// machine ended at 21, its own load. The reading is the core budget's own; "quiet" is no whole core
// busy beyond the background a developer machine always carries.
//
// **Between the ends, the load is read off the core budget's ledger, not the CPU**.
// Two readings missed every lane whose lint, tests or `ship` ran only while
// the gate did: seven lanes moved the solo median from 50.5s to 60.9s with no commit between. The CPU
// mid-gate holds this gate's own checks, whose declared weights are not what they burn, so the ledger
// is what tells the two apart: another `josh` run's admitted claim is another process's place, and its
// weight is the cores it holds. A claim still waiting holds none.

// **The background a quiet machine still carries.** On 2026-10-07 the 11-core machine idled at about
// 1.5 cores outside `josh` — Claude sessions 0.55, the window server 0.47, a browser 0.5. Admission
// counts it (`machine_capacity.external_cores`, joshuafolkken/kit#4238), but a gate timed beside it is
// still a solo gate for `josh metrics`, so it is no external load here.
const BACKGROUND_CORES = 2
// Often enough to catch another lane's shortest related lint, seldom enough that reading the markers —
// a process probe each — costs the gate nothing it could measure.
const SAMPLE_INTERVAL_MS = 3000

// Where the line goes, the external load read so far — before the first check started, then every
// sample since — and the timer taking the samples. No readings and no timer when no ledger was
// resolved: a suite driving the gate reads the machine for nothing.
interface GateLedgerStart {
	ledger_path: string | undefined
	readings: Array<number | undefined>
	sampler: ReturnType<typeof setInterval> | undefined
}

interface GateOutcome {
	elapsed_ms: number
	is_passed: boolean
}

// `undefined` where the machine could not be read — a CI runner, a CPU quota narrower than the host.
async function read_external_cores(): Promise<number | undefined> {
	const { busy_cores } = await machine_capacity.read_machine()

	if (busy_cores === undefined) return undefined

	return machine_capacity.external_cores(busy_cores, BACKGROUND_CORES)
}

// The cores other processes' admitted claims hold now. This gate's own claims are written by this
// process, and its checks' dispatches claim nothing under its held mark.
function read_foreign_cores(): number {
	const foreign = core_budget
		.live_reservations()
		.filter(
			({ reservation }) =>
				!process_identity.is_own_process(reservation.pid, reservation.process_start),
		)

	return core_admission.ledger_load(foreign, Date.now()).cores
}

// The highest reading; one unread reading leaves the whole gate unread rather than half-quiet.
function peak(readings: ReadonlyArray<number | undefined>): number | undefined {
	const read = readings.filter((reading) => reading !== undefined)

	if (read.length < readings.length) return undefined

	return Math.max(...read)
}

// Unreferenced, so a gate that throws before `record` never holds the process open on the timer.
function start_sampler(readings: Array<number | undefined>): ReturnType<typeof setInterval> {
	return setInterval(() => {
		readings.push(read_foreign_cores())
	}, SAMPLE_INTERVAL_MS).unref()
}

async function start(ledger_path: string | undefined): Promise<GateLedgerStart> {
	if (ledger_path === undefined) return { ledger_path, readings: [], sampler: undefined }

	const readings = [await read_external_cores()]

	return { ledger_path, readings, sampler: start_sampler(readings) }
}

function check_records(results: ReadonlyArray<GateStepResult>): Array<GateCheckRecord> {
	return results.map((result) => ({
		label: result.label,
		elapsed_ms: result.elapsed_ms,
		is_passed: !gate_report.is_gate_step_failed(result),
		is_reused: result.reused_at !== undefined,
		...(result.cpu_ms !== undefined && { cpu_ms: Math.round(result.cpu_ms) }),
		fallback:
			result.label === gate_plan.UNIT_LABEL
				? related_scope.fallback_kind(result.output)
				: undefined,
		claim: result.claim,
	}))
}

// A gate that reused a green record started no check: its line is counted as reused, never timed.
async function record_reused(ledger_path: string | undefined, elapsed_ms: number): Promise<void> {
	if (ledger_path === undefined) return

	await lane_ledger.record_gate(ledger_path, { elapsed_ms, is_passed: true, is_reused: true })
}

// The caller measures the elapsed time before this, so the end's reading is never part of it.
async function record(
	begun: GateLedgerStart,
	results: ReadonlyArray<GateStepResult>,
	outcome: GateOutcome,
): Promise<void> {
	clearInterval(begun.sampler)

	if (begun.ledger_path === undefined) return

	const unit_ms = results.find((result) => result.label === gate_plan.UNIT_LABEL)?.elapsed_ms
	const external_cores = peak([...begun.readings, await read_external_cores()])

	await lane_ledger.record_gate(begun.ledger_path, {
		...outcome,
		unit_ms,
		external_cores,
		checks: check_records(results),
	})
}

const gate_ledger = {
	BACKGROUND_CORES,
	SAMPLE_INTERVAL_MS,
	record,
	record_reused,
	start,
}

export type { GateLedgerStart }
export { gate_ledger }
