import { lane_ledger } from '#scripts/lane/lane-ledger'
import { gate_plan } from './gate-plan'
import type { GateStepResult } from './gate-report'
import { machine_capacity } from './machine-capacity'

// A finished gate's line in the lane ledger (joshuafolkken/kit#3355): its duration, its verdict, its
// unit suite's duration, and the load it ran beside (joshuafolkken/kit#3501), so `josh metrics`
// compares only gates the machine was quiet for. Another gate's span is not the only load: another
// lane's lint, related tests or `ship` doubled a solo gate's duration within minutes.
//
// **The load is read where none of the gate's own checks runs — before the first starts and after the
// last ends.** The load average cannot tell the two apart: a solo gate started at 4 on the 11-core
// machine ended at 21, its own load. The reading is the core budget's own, so "quiet" means what
// admission means by it: no whole core busy beyond the baseline the gate's weights were measured beside.

const NO_LEDGER_CORES = 0

// Where the line goes, and the external load before the first check started. Both are `undefined`
// when no ledger was resolved — a suite driving the gate reads the machine for nothing.
interface GateLedgerStart {
	ledger_path: string | undefined
	external_cores: number | undefined
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

// The higher of the two readings; one unread end leaves the whole gate unread rather than half-quiet.
function peak(first: number | undefined, last: number | undefined): number | undefined {
	if (first === undefined || last === undefined) return undefined

	return Math.max(first, last)
}

async function start(ledger_path: string | undefined): Promise<GateLedgerStart> {
	if (ledger_path === undefined) return { ledger_path, external_cores: undefined }

	return { ledger_path, external_cores: await read_external_cores() }
}

// The caller measures the elapsed time before this, so the end's reading is never part of it.
async function record(
	begun: GateLedgerStart,
	results: ReadonlyArray<GateStepResult>,
	outcome: GateOutcome,
): Promise<void> {
	if (begun.ledger_path === undefined) return

	const unit_ms = results.find((result) => result.label === gate_plan.UNIT_LABEL)?.elapsed_ms
	const external_cores = peak(begun.external_cores, await read_external_cores())

	await lane_ledger.record_gate(begun.ledger_path, { ...outcome, unit_ms, external_cores })
}

const gate_ledger = {
	record,
	start,
}

export type { GateLedgerStart }
export { gate_ledger }
