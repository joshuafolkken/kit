import path from 'node:path'
import { PLATFORM_TEMP_ROOT, platform_temporary } from '#scripts/josh/platform-temporary'

// **Where the durable records live and what they are called, with nothing that asks git** — the part of
// `durable-state.ts` a reader that may not spawn `git rev-parse` or import its modules shares: the
// vitest config counts the open lanes from their lane-state records at load (`unit-run-marker.ts`,
// joshuafolkken/kit#6916). The common git directory is the caller's to supply.

// josh's own per-clone state inside the common git directory, in one entry of it so nothing josh writes
// sits at its root beside git's own files.
const STATE_DIRECTORY = 'josh'
const RUN_STATE_DIRECTORY = 'run-state'
const OVERRIDE_STATE_DIRECTORY = 'josh-state'

// **The common git directory is asked only when no override stands**: asking it is a `git rev-parse`
// of the checkout, and under the unit suite's override every record lookup paid that probe for an
// answer it then discarded — what timed a suite out under gate load (joshuafolkken/kit#6177).
function state_root(override: string | undefined, read_common: () => string | undefined): string {
	if (override !== undefined && override !== '') {
		return path.join(override, OVERRIDE_STATE_DIRECTORY)
	}

	const common = read_common()

	if (common === undefined) return PLATFORM_TEMP_ROOT

	return path.join(common, STATE_DIRECTORY, RUN_STATE_DIRECTORY)
}

// Read once at import, as `PLATFORM_TEMP_ROOT` is, so both roots answer for the same override.
const STATE_ROOT_OVERRIDE = process.env[platform_temporary.TEMP_ROOT_KEY]

// Every record kept here, by the prefix of its file name — the list the one-time copy from `/tmp`
// walks, so a record added here is carried over with the rest.
const PREFIX = {
	CARRY: 'josh-run-carry-',
	ENDED: 'josh-run-ended-',
	EVENTS: 'josh-run-events-',
	LANE_STATE: 'josh-lane-state-',
	LANE_LEDGER: 'josh-lane-ledger-',
	WAKE_LOG: 'josh-run-wake-log-',
	BACKLOGRUN_LAUNCH: 'josh-backlogrun-launch-',
	BACKLOGRUN_LOG: 'josh-backlogrun-log-',
	HANDOFF_LOG: 'josh-run-handoff-log-',
	SHIP_LOG: 'josh-ship-log-',
	SHIP_RESULT: 'josh-ship-result-',
	LANE_DISPATCH: 'josh-lane-dispatch-',
	LANE_PLAN: 'josh-lane-plan-',
	INVESTIGATION: 'josh-investigation-record-',
	GH_USAGE: 'josh-gh-usage-',
} as const

const durable_state_root = {
	PREFIX,
	STATE_DIRECTORY,
	STATE_ROOT_OVERRIDE,
	state_root,
}

export { durable_state_root }
