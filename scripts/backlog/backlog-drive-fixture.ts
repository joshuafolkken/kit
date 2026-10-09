import type { LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import { backlog_drive, type DriveState, type LoopPorts, type OfferRead } from './backlog-drive'

// The scripted ports every `backlog_drive` suite drives the loop through — one copy, so the suites
// cannot drift on how a child finishes, a merge answers or an offer is queued.

const ACTIVE = '2026-09-24T00:00:00.000Z'
const START_MS = Date.parse(ACTIVE)
const POLL_MS = 5000
const OFFER_MS = 60_000
const CONFIG = { poll_ms: POLL_MS, offer_ms: OFFER_MS, window_ms: undefined }
const FIRST_CHILD = '2400'
const SECOND_CHILD = '2401'
const OFFERED = '2500'
const OFFERED_TOO = '2501'
// The next-issue token `run:merge` prints after an ordinary merge.
const NEXT_TOKEN = '2600'
// A free-lane answer above any offer a suite queues, so only a suite that sets one meets the limit.
const ROOMY_POOL = 6

interface Harness {
	ports: LoopPorts
	calls: Array<string>
	offers: Array<DriveState>
	states: Array<DriveState>
}

interface Script {
	finished?: ReadonlyArray<string>
	merges?: ReadonlyMap<string, string>
	// Children `run:merge` handled as parked rather than merged; every other reads as merged.
	parked?: ReadonlyArray<string>
	offers?: ReadonlyArray<OfferRead | undefined>
	// Launches that failed after `lane:open` took a lane, and ones `lane:open` itself refused.
	failed_launches?: ReadonlyArray<string>
	unopened_launches?: ReadonlyArray<string>
	// The free-lane answers in order, the last repeating; unset reads as a pool with room to spare.
	free_lanes?: ReadonlyArray<number>
}

function offer(verdict: string, issues: ReadonlyArray<string> = []): OfferRead {
	return { verdict, issues, retries: 0 }
}

// The child-facing ports: a finished child is merged once and then reads as gone.
function child_ports(
	script: Script,
	calls: Array<string>,
): Pick<LoopPorts, 'is_finished' | 'merge'> {
	const finished = new Set(script.finished)

	return {
		is_finished: (issue) => finished.has(issue),
		merge: async (issue) => {
			calls.push(`merge ${issue}`)
			finished.delete(issue)

			const outcome = script.parked?.includes(issue) === true ? 'parked' : 'merged'

			return { token: script.merges?.get(issue) ?? NEXT_TOKEN, outcome }
		},
	}
}

function launch_outcome(script: Script, issue: string): LaunchOutcome['kind'] {
	if (script.failed_launches?.includes(issue) === true) return 'failed'

	return script.unopened_launches?.includes(issue) === true ? 'unopened' : 'launched'
}

// The dispatch-facing ports: offers answer from the script's queue, then `wait`.
function dispatch_ports(
	script: Script,
	calls: Array<string>,
	offers: Array<DriveState>,
): Pick<LoopPorts, 'offer' | 'launch' | 'free_lanes'> {
	const queue = [...(script.offers ?? [])]
	const free = [...(script.free_lanes ?? [ROOMY_POOL])]

	return {
		free_lanes: async () => (free.length > 1 ? free.shift() : free[0]) ?? ROOMY_POOL,
		offer: async (asked) => {
			calls.push('offer')
			offers.push(asked)

			return queue.length === 0 ? offer('wait') : queue.shift()
		},
		launch: async (issue) => {
			calls.push(`launch ${issue}`)

			return launch_outcome(script, issue)
		},
	}
}

// The loop-facing ports: a clock the sleeps advance, and the finish and state records.
function loop_ports(
	calls: Array<string>,
	states: Array<DriveState>,
): Pick<LoopPorts, 'now' | 'sleep' | 'finish' | 'on_state'> {
	let now_ms = START_MS

	return {
		now: () => new Date(now_ms),
		sleep: async (milliseconds) => {
			now_ms += milliseconds
		},
		finish: async () => {
			calls.push('finish')
		},
		on_state: (next) => {
			states.push(next)
		},
	}
}

function harness(script: Script): Harness {
	const calls: Array<string> = []
	const offers: Array<DriveState> = []
	const states: Array<DriveState> = []

	return {
		calls,
		offers,
		states,
		ports: {
			...child_ports(script, calls),
			...dispatch_ports(script, calls, offers),
			...loop_ports(calls, states),
		},
	}
}

function state(in_flight: ReadonlyArray<string> = []): DriveState {
	return backlog_drive.initial_state(in_flight, ACTIVE)
}

const backlog_drive_fixture = {
	CONFIG,
	FIRST_CHILD,
	OFFERED,
	OFFERED_TOO,
	POLL_MS,
	SECOND_CHILD,
	harness,
	offer,
	state,
}

export type { Harness, Script }
export { backlog_drive_fixture }
