import { lane_ledger } from '#scripts/lane/lane-ledger'
import type { DriveEnd, DrivePorts, DriveState, OfferRead, PassResult } from './backlog-drive'
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
// fill the pool, and no dispatch of this driver's would end that hold. A full pool's release is written
// once per hold, so it does not add a line on every pass; the finished run's is written every time.

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

// The issues an offer that started nothing waited on, when it named them (joshuafolkken/kit#4513).
interface HeldWaiting {
	waiting?: ReadonlyArray<number> | undefined
}

// A hold's reason, `undefined` for the finished run, and the issues its offer waited on.
interface HeldDraft extends HeldWaiting {
	reason: string | undefined
}

// Whether a hold may still be open — at a driver's start, one an earlier driver's hand-back left.
interface HoldLedger {
	is_open: boolean
}

// The reason an offer that started nothing holds a free lane, or `undefined` for the run's stop. The
// offer's cause stands in for its answer, so a `run:solo` wait is `offer:watch:solo` rather than one
// more `offer:watch:blocked` (joshuafolkken/kit#4396), and a dependency-chain or start-condition wait is
// `offer:watch:chain`, `offer:watch:gate` or `offer:watch:chain+gate` (joshuafolkken/kit#4513).
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
	if (result.kind === 'continue') await ports.hold(offer_reason(read), read.waiting)

	return result
}

// A collection whose `run:merge` answered `stop` — the consecutive-failure guard — finishes the run as
// an offer's `stop` does, but no offer follows it to release the hold, so it is released here. Left
// open, the lanes it freed read as held until the next driver's first offer (joshuafolkken/kit#4571).
async function stopped(
	before: DriveState,
	after: DriveState,
	ports: Pick<DrivePorts, 'hold'>,
): Promise<void> {
	if (after.is_stopping && !before.is_stopping) await ports.hold(undefined)
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
	ledger.is_open = false
	await lane_ledger.record_released()
}

async function release_open(ledger: HoldLedger): Promise<void> {
	if (ledger.is_open) await release(ledger)
}

// A ledger line only while a lane is free. The finished run always writes its release: children parked
// since a full pool's release still wait for an offer answer, and only this line ends their wait
// (joshuafolkken/kit#4571). A full pool releases the open hold once, not on every pass.
async function record(
	ledger: HoldLedger,
	draft: HeldDraft,
	count: number | undefined,
): Promise<void> {
	if (count === undefined) return

	if (draft.reason === undefined) {
		await release(ledger)

		return
	}

	if (count === NO_FREE_LANES) {
		await release_open(ledger)

		return
	}

	ledger.is_open = true
	await lane_ledger.record_held({ reason: draft.reason, waiting: draft.waiting })
}

// The production `hold` port and the driver's end, sharing whether a hold is open. Best-effort like
// every ledger write — an unreadable lane limit records nothing rather than failing the driver.
function recorder(
	free_lanes: () => Promise<number> = backlog_ready.drive_free_lane_count,
): HoldRecorder {
	const ledger: HoldLedger = { is_open: true }

	async function write(reason: string | undefined, waiting?: ReadonlyArray<number>): Promise<void> {
		await record(ledger, { reason, waiting }, await free_count(free_lanes, reason))
	}

	return {
		hold: write,
		end: async (end) => {
			await write(hand_back_reason(end))
		},
	}
}

const backlog_drive_hold = { hand_back_reason, held, recorder, stopped }

export { backlog_drive_hold }
export type { HeldWaiting, HoldRecorder }
