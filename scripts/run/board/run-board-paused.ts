import { lane_paused } from '#scripts/lane/lane-paused'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#4198: a lane whose processes are all suspended — by `lane:pause` or a hand-sent
// `kill -STOP` — is drawn `paused`, not running with its time and spinner going on.
//
// **Read off the board's own `ps` sample, never a probe of its own.** Each process's `stat` rides on
// the one listing the usage columns already take, and each process's lane is the one that listing
// already found, so a paused lane costs no `pgrep` or `ps` of its own.
//
// **What paused means is `lane_paused.is_paused`'s** — the one reading the lane limit counts on too.
// **The time a lane was first seen paused is kept** across samples, so the row's elapsed time stops
// there rather than counting on.

const PAUSED_STATE = 'paused'
const RUNNING_STATE = 'running'

// What a process's `ps` line says about its state: `stat`'s first letter is the state.
interface StatedProcess {
	stat: string
}

// Each lane's processes' states.
function lane_states(
	listed: ReadonlyMap<number, StatedProcess>,
	lanes: ReadonlyMap<number, string | undefined>,
): Map<string, Array<string>> {
	const states = new Map<string, Array<string>>()

	for (const [pid, { stat }] of listed) {
		const lane = lanes.get(pid)

		if (lane !== undefined) states.set(lane, [...(states.get(lane) ?? []), stat])
	}

	return states
}

/** The lanes with at least one live process, every one of them stopped. */
function paused_lanes(
	listed: ReadonlyMap<number, StatedProcess>,
	lanes: ReadonlyMap<number, string | undefined>,
): Set<string> {
	const states = [...lane_states(listed, lanes)]
	const paused = states.filter(([, stats]) => lane_paused.is_paused(stats))

	return new Set(paused.map(([lane]) => lane))
}

/** Each paused lane with when it was first seen paused: `earlier`'s moment kept, a new one `at_ms`. */
function paused_since(
	earlier: ReadonlyMap<string, number> | undefined,
	paused: ReadonlySet<string>,
	at_ms: number,
): Map<string, number> {
	return new Map([...paused].map((lane) => [lane, earlier?.get(lane) ?? at_ms] as const))
}

function paused_status(status: ItemStatus, since: number | undefined): ItemStatus {
	if (since === undefined || status.state !== RUNNING_STATE) return status

	return { ...status, state: PAUSED_STATE, ended_ms: since }
}

/** The running children whose lane is paused, drawn paused and timed until they were first seen so. */
function paused_over(
	statuses: ReadonlyMap<number, ItemStatus>,
	paused: ReadonlyMap<string, number> | undefined,
): ReadonlyMap<number, ItemStatus> {
	if (paused === undefined || paused.size === 0) return statuses

	const entries = [...statuses].map(
		([issue, status]) => [issue, paused_status(status, paused.get(String(issue)))] as const,
	)

	return new Map(entries)
}

const run_board_paused = { paused_lanes, paused_over, paused_since }

export { run_board_paused }
export type { StatedProcess }
