import { process_identity } from '#scripts/josh/process-identity'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'
import { machine_capacity } from './machine-capacity'

// A finished gate's line in the lane ledger: its duration, its verdict, its
// unit suite's duration, and the load it ran beside, so `josh metrics`
// compares only gates the machine was quiet for. Another gate's span is not the only load: another
// lane's lint, related tests or `ship` doubled a solo gate's duration within minutes.
//
// **The machine is read where none of the gate's own checks runs — before the first starts and after
// the last ends.** The load average cannot tell the two apart: a solo gate started at 4 on the 11-core
// machine ended at 21, its own load. The reading is the core budget's own, so "quiet" means what
// admission means by it: no whole core busy beyond the baseline the gate's weights were measured beside.
//
// **Between the ends, the load is read off the core budget's ledger, not the CPU**.
// Two readings missed every lane whose lint, tests or `ship` ran only while
// the gate did: seven lanes moved the solo median from 50.5s to 60.9s with no commit between. The CPU
// mid-gate holds this gate's own checks, whose declared weights are not what they burn, so the ledger
// is what tells the two apart: another `josh` run's admitted claim is another process's place, and its
// weight is the cores it holds. A claim still waiting holds none.

const NO_LEDGER_CORES = 0
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

	return machine_capacity.external_cores(busy_cores, NO_LEDGER_CORES)
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

	await lane_ledger.record_gate(begun.ledger_path, { ...outcome, unit_ms, external_cores })
}

const gate_ledger = {
	SAMPLE_INTERVAL_MS,
	record,
	start,
}

export type { GateLedgerStart }
export { gate_ledger }
