import type { DrivePorts, OfferRead } from './backlog-drive'

// **A free lane with nothing opted in is the open backlog's turn to be judged**
// (joshuafolkken/kit#3854): a watch over an exhausted pool hands back `judge` while an open issue
// lacking `auto-ok` still owes a judgement, ahead of the drain it would otherwise be. Once every one
// carries its judgement comment the count is zero and the watch is the driver's again.

const WATCH_VERDICT = 'watch'
const EXHAUSTED_ANSWER = 'exhausted'
const NO_FREE_LANES = 0

async function is_owed(
	read: OfferRead,
	ports: Pick<DrivePorts, 'free_lanes' | 'judgement_owed'>,
): Promise<boolean> {
	const is_exhausted = read.verdict === WATCH_VERDICT && read.answer === EXHAUSTED_ANSWER

	if (!is_exhausted || (await ports.free_lanes()) <= NO_FREE_LANES) return false

	return (await ports.judgement_owed()) > 0
}

const backlog_drive_judge = { is_owed }

export { backlog_drive_judge }
