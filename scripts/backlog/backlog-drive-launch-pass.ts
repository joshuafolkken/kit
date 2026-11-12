import type { LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import type { DrivePorts, DriveState, PassResult } from './backlog-drive'
import { backlog_drive_seats } from './backlog-drive-seats'

// The launches of one offered pass, out of `backlog-drive.ts` so the loop stays within its size.

const NO_FREE_LANES = 0
const LAUNCHED = 'launched'
const UNOPENED = 'unopened'
// The launch port's answer for an issue its measurement declaration closed (`backlog-measure-close.ts`).
const MEASURED_LAUNCH = 'measured' as const
// Its answer for an issue whose declaration has no sample yet: it waits, so this drive re-offers it no
// more and a later drive measures it again (joshuafolkken/kit#6503).
const UNSAMPLED_LAUNCH = 'unsampled' as const
// Its answer for an issue over the size bar its split-only unit split into children
// (`backlog-drive-split-unit.ts`): the parent is an epic now, so it is excluded as a measured close is.
const SPLIT_LAUNCH = 'split' as const

type DriveLaunch =
	LaunchOutcome['kind'] | typeof MEASURED_LAUNCH | typeof UNSAMPLED_LAUNCH | typeof SPLIT_LAUNCH

interface Settled {
	in_flight: Array<string>
	measured: Array<string>
	unsampled: Array<string>
}

// **A refused launch is a mechanical failure, not a question** (joshuafolkken/kit#6878): it is parked
// with `run:stalled` before it is handed back, so no session parks it as `needs-decision` and the next
// offer does not hand it straight back. A seat probe that could not read the lanes' processes or ports
// refuses `lane:open` too, so it reaches here as `unopened` with lanes free.
async function handed_back(
	issue: string,
	outcome: DriveLaunch,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	await ports.stall(issue, outcome)

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
	if (outcome === 'waiting') return { kind: 'continue', state }
	if (outcome !== UNOPENED) return await handed_back(issue, outcome, state, ports)
	if ((await ports.free_lanes()) <= NO_FREE_LANES) return { kind: 'continue', state }

	return await handed_back(issue, outcome, state, ports)
}

// **Only a launch or a measured close is activity**: a pass that started nothing — every lane taken
// — keeps `active` where it was, or the once-a-minute offer would restart the idle budget for good. A
// measured issue is closed but may still read OPEN to `backlog:next`, so it is excluded as a merge is.
// An unsampled issue started nothing: it goes to `waiting`, kept out of the offer but not counted merged.
function launched(state: DriveState, settled: Settled, ports: DrivePorts): DriveState {
	const { in_flight, measured, unsampled } = settled
	const exclude = [...state.exclude, ...measured]
	const waiting = [...(state.waiting ?? []), ...unsampled]

	if (in_flight.length === state.in_flight.length && measured.length === 0) {
		return { ...state, in_flight, exclude, waiting }
	}

	return { ...state, in_flight, exclude, waiting, active: ports.now().toISOString() }
}

// Whether the launch settled the issue — into flight, closed by its measurement, split by its split-only
// unit, or waiting for a sample.
const SETTLED: ReadonlySet<DriveLaunch> = new Set([
	MEASURED_LAUNCH,
	LAUNCHED,
	UNSAMPLED_LAUNCH,
	SPLIT_LAUNCH,
])

function is_settled(outcome: DriveLaunch): boolean {
	return SETTLED.has(outcome)
}

function settle(settled: Settled, issue: string, outcome: DriveLaunch): void {
	if (outcome === MEASURED_LAUNCH || outcome === SPLIT_LAUNCH) settled.measured.push(issue)
	if (outcome === UNSAMPLED_LAUNCH) settled.unsampled.push(issue)
	if (outcome === LAUNCHED) settled.in_flight.push(issue)
}

interface Launched {
	issue: string
	outcome: DriveLaunch
}

// Every launch runs to its end before a failure is thrown, so none is still opening a lane once the
// pass has given up.
async function launch_each(
	issues: ReadonlyArray<string>,
	ports: DrivePorts,
): Promise<Array<Launched>> {
	const results = await Promise.allSettled(
		issues.map(async (issue) => ({ issue, outcome: await ports.launch(issue) })),
	)
	const failure = results.find((result) => result.status === 'rejected')

	if (failure !== undefined) throw failure.reason

	return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
}

// **No more new lanes than free lanes**. `backlog:offer` lists every ready issue without reading the
// lanes, so launching all of them overran `JOSH_LANE_LIMIT` until `lane:open` ran out of seats. An issue
// that already holds a kept lane reuses its port seat but takes a place under the limit, ahead of a
// fresh launch; the rest launch up to the free count (`backlog-drive-seats.ts`), read before the first.
//
// **The pass's launches run side by side** (joshuafolkken/kit#5519): one after another, four lanes took
// 49 s. Their outcomes are then settled in offer order, so every lane that launched is in flight
// whichever refused, and the first refusal in that order is the one the pass answers. A split-only unit
// holds the pass for its minutes (`backlog-drive-split-unit.ts`): accepted, since it runs once per
// over-bar issue and its split changes what the next offer lists.
async function launch_all(
	issues: ReadonlyArray<string>,
	state: DriveState,
	ports: DrivePorts,
): Promise<PassResult> {
	const settled: Settled = { in_flight: [...state.in_flight], measured: [], unsampled: [] }
	const launching = await backlog_drive_seats.seated(issues, ports)
	const outcomes = await launch_each(launching, ports)
	for (const { issue, outcome } of outcomes) settle(settled, issue, outcome)

	const refusal = outcomes.find(({ outcome }) => !is_settled(outcome))
	const next = launched(state, settled, ports)

	if (refusal === undefined) return { kind: 'continue', state: next }

	return await refused(refusal.issue, refusal.outcome, next, ports)
}

const backlog_drive_launch_pass = { MEASURED_LAUNCH, SPLIT_LAUNCH, UNSAMPLED_LAUNCH, launch_all }

export type { DriveLaunch }
export { backlog_drive_launch_pass }
