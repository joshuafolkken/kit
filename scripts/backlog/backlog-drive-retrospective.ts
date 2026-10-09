import { doctor_consumer } from '#scripts/doctor/doctor-consumer'
import { find_package_directory } from '#scripts/josh/josh-logic'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_retrospective } from '#scripts/run/run-retrospective'

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

export const backlog_drive_retrospective = { is_owed }
