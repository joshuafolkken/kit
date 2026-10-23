import type { LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import type { DrivePorts, DriveState, PassResult } from './backlog-drive'
import { backlog_drive_seats } from './backlog-drive-seats'

// The launches of one offered pass, out of `backlog-drive.ts` so the loop stays within its size.

const NO_FREE_LANES = 0
const LAUNCHED = 'launched'
const UNOPENED = 'unopened'
// The launch port's answer for an issue its measurement declaration closed (`backlog-measure-close.ts`).
const MEASURED_LAUNCH = 'measured' as const

type DriveLaunch = LaunchOutcome['kind'] | typeof MEASURED_LAUNCH

interface Settled {
	in_flight: Array<string>
	measured: Array<string>
}

function handed_back(issue: string, state: DriveState): PassResult {
	return { kind: 'end', end: { reason: 'launch', token: undefined, issue }, state }
}

// A `lane:open` refused with every lane taken is a wait, not a judgement: the
// next offer after a lane frees retries it. A step failing after the lane opened is always handed back —
// that lane holds the last seat itself, so the free count would read the failure as a full pool.
async function refused(
	issue: string,
	outcome: DriveLaunch,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	if (outcome !== UNOPENED) return handed_back(issue, state)
	if ((await ports.free_lanes()) <= NO_FREE_LANES) return { kind: 'continue', state }

	return handed_back(issue, state)
}

// **Only a launch or a measured close is activity**: a pass that started nothing — every lane taken
// — keeps `active` where it was, or the once-a-minute offer would restart the idle budget for good. A
// measured issue is closed but may still read OPEN to `backlog:next`, so it is excluded as a merge is.
function launched(state: DriveState, settled: Settled, ports: DrivePorts): DriveState {
	const { in_flight, measured } = settled

	if (in_flight.length === state.in_flight.length && measured.length === 0) {
		return { ...state, in_flight }
	}

	const exclude = [...state.exclude, ...measured]

	return { ...state, in_flight, exclude, active: ports.now().toISOString() }
}

// Whether the launch settled the issue — into flight, or closed by its measurement.
function is_settled(settled: Settled, issue: string, outcome: DriveLaunch): boolean {
	if (outcome === MEASURED_LAUNCH) settled.measured.push(issue)
	if (outcome === LAUNCHED) settled.in_flight.push(issue)

	return outcome === MEASURED_LAUNCH || outcome === LAUNCHED
}

// **No more new lanes than free lanes**. `backlog:offer` lists every ready issue without reading the
// lanes, so launching all of them overran `JOSH_LANE_LIMIT` until `lane:open` ran out of seats. An issue
// that already holds a kept lane reuses its port seat but takes a place under the limit, ahead of a
// fresh launch; the rest launch up to the free count (`backlog-drive-seats.ts`), read before the first.
async function launch_all(
	issues: ReadonlyArray<string>,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	const settled: Settled = { in_flight: [...state.in_flight], measured: [] }
	const launching = await backlog_drive_seats.seated(issues, ports)

	for (const issue of launching) {
		// eslint-disable-next-line no-await-in-loop -- lanes launch in order and the first refusal ends the pass
		const outcome = await ports.launch(issue)

		if (!is_settled(settled, issue, outcome)) {
			// eslint-disable-next-line no-await-in-loop -- lanes launch in order and the first refusal ends the pass
			return await refused(issue, outcome, launched(state, settled, ports), ports)
		}
	}

	return { kind: 'continue', state: launched(state, settled, ports) }
}

const backlog_drive_launch_pass = { MEASURED_LAUNCH, launch_all }

export type { DriveLaunch }
export { backlog_drive_launch_pass }
