import type { CoreWaitRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import type { Admission } from './core-admission'

// How long a claim waited for the core budget, written to the lane ledger once it is admitted, so
// `josh lane:stats` can split a lane's time into work and waiting (joshuafolkken/kit#4382). The
// waiting line on stderr says a wait started; this says what it cost.
//
// Immediate admissions use a separate ledger kind so wait counts and medians keep their old meaning.
// Both kinds retain the admission grounds; legacy waits without those fields still read.

const UNNAMED_COMMAND = 'a step'

// What `core-budget.ts` knows of the claim when it is admitted.
interface AdmittedClaim {
	command?: string | undefined
	lane?: string | undefined
	wait_reason?: string | undefined
	claimed_at: number
	weight?: number | undefined
	memory_mb?: number | undefined
}

type WaitSink = (wait: CoreWaitRecord) => Promise<void>

async function to_ledger(wait: CoreWaitRecord): Promise<void> {
	await lane_ledger_write.record_core_wait(wait)
}

function request_fields(claim: AdmittedClaim, admission?: Admission): Partial<CoreWaitRecord> {
	return {
		requested_cores: claim.weight,
		granted_cores: admission?.granted ?? claim.weight,
		memory_mb: claim.memory_mb ?? 0,
		wait_reason: claim.wait_reason,
		admission_waited_ms: admission?.waited_ms,
	}
}

function admission_fields(claim: AdmittedClaim, admission?: Admission): Partial<CoreWaitRecord> {
	const decision = admission?.decision

	if (decision === undefined) return {}

	return {
		...request_fields(claim, admission),
		admission_reason: decision.reason,
		overflow: admission?.overflow !== undefined,
		budget_cores: decision.budget.cores,
		budget_memory_mb: Number.isFinite(decision.budget.memory_mb)
			? decision.budget.memory_mb
			: undefined,
		available_mb: decision.reading.available_mb,
		busy_cores: decision.reading.busy_cores,
		memory_pressured: decision.reading.memory_pressured,
	}
}

function should_record(claim: AdmittedClaim, admission?: Admission): boolean {
	return claim.wait_reason !== undefined || admission?.decision !== undefined
}

function wait_of(
	claim: AdmittedClaim,
	now: number,
	admission?: Admission,
): CoreWaitRecord | undefined {
	if (!should_record(claim, admission)) return undefined

	const waited_ms = claim.wait_reason === undefined ? 0 : now - claim.claimed_at
	const wait = {
		command: claim.command ?? UNNAMED_COMMAND,
		waited_ms,
		...admission_fields(claim, admission),
	}

	return claim.lane === undefined ? wait : { ...wait, issue: Number(claim.lane) }
}

async function record_admitted(
	claim: AdmittedClaim,
	now: number,
	sink: WaitSink = to_ledger,
	admission?: Admission,
): Promise<void> {
	const wait = wait_of(claim, now, admission)

	if (wait !== undefined) await sink(wait)
}

const core_wait_record = { record_admitted, wait_of }

export type { WaitSink }
export { core_wait_record }
