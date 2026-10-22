import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { DriveEnd, DrivePorts, OfferRead, PassResult } from './backlog-drive'
import { backlog_ready } from './backlog-ready'

// Why a free lane stayed empty, written where `josh lane:stats` reads it (joshuafolkken/kit#3995).
//
// **The driver already dispatches the moment a lane frees**: a pass that collected a child asks the
// offer at once (`backlog-drive.ts` → `is_offering`). What a backlog stall episode could not say is
// why a free lane then stayed empty — an offer that started nothing, or the driver handed back to a
// session that had not restarted it yet. Each such pass records its reason; the time is derived in
// `lane-held-stats.ts`, so a hold is told apart from a dispatch that was simply slow.
//
// **Only a free lane is a hold.** Every lane taken is the limit doing its job, not idle capacity, and a
// finished run — a `stop`, the drain's `watch` or `retrospective` — owes no lane a child. Either writes
// a `released` entry instead, which ends the hold before it: a lane opened outside this driver can
// fill the pool, and no dispatch of this driver's would end that hold. The release is written once per
// hold, so a full pool does not add a line on every pass.

const NO_FREE_LANES = 0
const OFFER_PREFIX = 'offer'
const HAND_BACK_PREFIX = 'hand-back'
const REASON_SEPARATOR = ':'
// The verdict that starts nothing more: the run is finishing, so the lanes it frees are no hold.
const STOP_VERDICT = 'stop'
// The ends that finished the run: nothing is owed a lane after them.
const FINISHED_REASONS: ReadonlySet<string> = new Set([STOP_VERDICT, 'watch', 'retrospective'])

interface HoldRecorder {
	hold: DrivePorts['hold']
	end: (end: DriveEnd) => Promise<void>
}

// Whether a hold may still be open — at a driver's start, one an earlier driver's hand-back left.
interface HoldLedger {
	is_open: boolean
}

// The reason an offer that started nothing holds a free lane, or `undefined` for the run's stop. The
// offer's cause stands in for its answer, so a `run:solo` wait is `offer:watch:solo` rather than one
// more `offer:watch:blocked` (joshuafolkken/kit#4396).
function offer_reason(read: OfferRead): string | undefined {
	if (read.verdict === STOP_VERDICT) return undefined

	const detail = read.cause ?? read.answer
	const parts = [OFFER_PREFIX, read.verdict, ...(detail === undefined ? [] : [detail])]

	return parts.join(REASON_SEPARATOR)
}

// A continuing pass after an offer that started nothing is a hold; an ended one is the hand-back's.
async function held(
	result: PassResult,
	read: OfferRead,
	ports: Pick<DrivePorts, 'hold'>,
): Promise<PassResult> {
	if (result.kind === 'continue') await ports.hold(offer_reason(read))

	return result
}

// The reason a driver's end leaves the lanes waiting on a session, or `undefined` for the finished run.
function hand_back_reason(end: DriveEnd): string | undefined {
	if (FINISHED_REASONS.has(end.reason)) return undefined

	return [HAND_BACK_PREFIX, end.reason].join(REASON_SEPARATOR)
}

// The free count, or `undefined` where the lane limit is unreadable: no hold is known then. The
// finished run (`reason` absent) reads as a full pool — it holds no lane either way.
async function free_count(
	free_lanes: () => Promise<number>,
	reason: string | undefined,
): Promise<number | undefined> {
	if (reason === undefined) return NO_FREE_LANES

	try {
		return await free_lanes()
	} catch {
		return undefined
	}
}

async function release(ledger: HoldLedger): Promise<void> {
	if (!ledger.is_open) return

	ledger.is_open = false
	await lane_ledger.record_released()
}

// A ledger line only while a lane is free; a full pool or the finished run releases the open hold.
async function record(
	ledger: HoldLedger,
	reason: string | undefined,
	count: number | undefined,
): Promise<void> {
	if (count === undefined) return

	if (reason === undefined || count === NO_FREE_LANES) {
		await release(ledger)

		return
	}

	ledger.is_open = true
	await lane_ledger.record_held(reason)
}

// The production `hold` port and the driver's end, sharing whether a hold is open. Best-effort like
// every ledger write — an unreadable lane limit records nothing rather than failing the driver.
function recorder(
	free_lanes: () => Promise<number> = backlog_ready.drive_free_lane_count,
): HoldRecorder {
	const ledger: HoldLedger = { is_open: true }

	async function write(reason: string | undefined): Promise<void> {
		await record(ledger, reason, await free_count(free_lanes, reason))
	}

	return {
		hold: write,
		end: async (end) => {
			await write(hand_back_reason(end))
		},
	}
}

const backlog_drive_hold = { hand_back_reason, held, recorder }

export { backlog_drive_hold }
export type { HoldRecorder }
