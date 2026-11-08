import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { find_package_directory } from '#scripts/josh/josh-logic'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_retrospective } from '#scripts/run/run-retrospective'
import type { DrivePorts, DriveState, OfferRead, PassResult } from './backlog-drive'

const STOP_VERDICT = 'stop'
const EXHAUSTED_ANSWER = 'exhausted'
const RETROSPECTIVE_REASON = 'retrospective'

// Whether a drain owes the retrospective, read through the owed rule `run:step` reads, so a drain it
// owes nothing at keeps the idle watch rather than waking a session with nothing to run.
// The drive is the parent's loop, never a lane child's.
function is_owed(carry: RunCarry): boolean {
	const root = find_package_directory(process.cwd())

	return run_retrospective.is_owed({
		is_retrospective_enabled: run_retrospective.is_enabled(),
		is_lane_child: false,
		is_retrospective_done: carry.retrospective === true,
		is_consumer: doctor_consumer.is_kit_consumer(root),
	})
}

// A drain owing the retrospective, read under a `watch` or a `stop` verdict. Only an empty backlog
// drains: `backlog:offer` marks the drain on `exhausted` alone, so a watch over a parked or unreadable
// backlog has no retrospective for `run:step` to fire and stays the driver's.
function is_drain_owed(read: OfferRead, state: DriveState, verdict: string): boolean {
	return (
		read.verdict === verdict &&
		read.answer === EXHAUSTED_ANSWER &&
		state.in_flight.length === 0 &&
		read.is_retrospective_owed === true
	)
}

// A `stop` drain owing the retrospective runs the retrospective unit before the stop ends the run
// (joshuafolkken/kit#6745): the parent is the driver, so a retrospective handed back waited on a person.
// Only a unit that failed hands it back as `retrospective`, for the parent to run as before.
async function ran(
	result: PassResult,
	read: OfferRead,
	ports: Pick<DrivePorts, 'retrospective'>,
): Promise<PassResult> {
	if (result.kind === 'end' || !is_drain_owed(read, result.state, STOP_VERDICT)) return result

	if (await ports.retrospective()) return result

	const end = { reason: RETROSPECTIVE_REASON, token: RETROSPECTIVE_REASON, issue: undefined }

	return { kind: 'end', end, state: result.state }
}

export const backlog_drive_retrospective = { is_drain_owed, is_owed, ran }
