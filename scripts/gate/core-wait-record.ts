import type { CoreWaitRecord } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'

// How long a claim waited for the core budget, written to the lane ledger once it is admitted, so
// `josh lane:stats` can split a lane's time into work and waiting (joshuafolkken/kit#4382). The
// waiting line on stderr says a wait started; this says what it cost.
//
// **Only a claim that waited is recorded** — one admitted on its first read cost nothing, and a line per
// command would bury the waits a lane's time is split by. The lane is the claim's own checkout's, the
// one `run:board` names the waiting claim by.

const UNNAMED_COMMAND = 'a step'

// What `core-budget.ts` knows of the claim when it is admitted.
interface AdmittedClaim {
	command?: string | undefined
	lane?: string | undefined
	wait_reason?: string | undefined
	claimed_at: number
}

type WaitSink = (wait: CoreWaitRecord) => Promise<void>

async function to_ledger(wait: CoreWaitRecord): Promise<void> {
	await lane_ledger_write.record_core_wait(wait)
}

function wait_of(claim: AdmittedClaim, now: number): CoreWaitRecord | undefined {
	if (claim.wait_reason === undefined) return undefined

	const wait = { command: claim.command ?? UNNAMED_COMMAND, waited_ms: now - claim.claimed_at }

	return claim.lane === undefined ? wait : { ...wait, issue: Number(claim.lane) }
}

async function record_admitted(
	claim: AdmittedClaim,
	now: number,
	sink: WaitSink = to_ledger,
): Promise<void> {
	const wait = wait_of(claim, now)

	if (wait !== undefined) await sink(wait)
}

const core_wait_record = { record_admitted, wait_of }

export type { WaitSink }
export { core_wait_record }
