import type { LaunchOutcome } from '#scripts/lane/lane-launch-cli'
import type { MergeTokenRead } from '#scripts/run/merge/run-merge-token'
import { backlog_budget } from './backlog-budget'
import { backlog_drive, type DriveState, type LoopPorts, type OfferRead } from './backlog-drive'

// The scripted ports every `backlog_drive` suite drives the loop through — one copy, so the suites
// cannot drift on how a child finishes, a merge answers or an offer is queued.

const ACTIVE = '2026-09-24T00:00:00.000Z'
const START_MS = Date.parse(ACTIVE)
const POLL_MS = 5000
const OFFER_MS = backlog_budget.OFFER_INTERVAL_MS
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
	holds: Array<string | undefined>
	idles: Array<DriveState>
}

interface Script {
	finished?: ReadonlyArray<string>
	// A scripted token is `run:merge`'s control verdict unless the child is in `offered`, whose token is
	// the next offer passed through; an unscripted child answers the offer's `NEXT_TOKEN`.
	merges?: ReadonlyMap<string, string>
	offered?: ReadonlyArray<string>
	// Children `run:merge` handled as parked rather than merged; every other reads as merged.
	parked?: ReadonlyArray<string>
	offers?: ReadonlyArray<OfferRead | undefined>
	// Launches that failed after `lane:open` took a lane, and ones `lane:open` itself refused.
	failed_launches?: ReadonlyArray<string>
	unopened_launches?: ReadonlyArray<string>
	// The free-lane answers in order, the last repeating; unset reads as a pool with room to spare.
	free_lanes?: ReadonlyArray<number>
	// The limit-room answers in order, the last repeating; unset reads as the free-lane answers.
	limit_room?: ReadonlyArray<number>
	// The issues that already hold a kept lane; unset reads as none.
	kept_lanes?: ReadonlyArray<string>
	// How many open issues owe an `auto-ok` judgement; unset reads as none.
	judgement_owed?: number
	// The memory-hold answers in order, the last repeating; unset reads as memory to spare.
	memory_held?: ReadonlyArray<boolean>
}

function offer(verdict: string, issues: ReadonlyArray<string> = []): OfferRead {
	return { verdict, issues, retries: 0 }
}

function merge_token(script: Script, issue: string): MergeTokenRead {
	const token = script.merges?.get(issue)

	if (token === undefined) return { token: NEXT_TOKEN, is_offer: true }

	return { token, is_offer: script.offered?.includes(issue) === true }
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

			return { ...merge_token(script, issue), outcome }
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
): Pick<LoopPorts, 'offer' | 'launch' | 'judgement_owed'> {
	const queue = [...(script.offers ?? [])]

	return {
		judgement_owed: async () => {
			calls.push('judgement')

			return script.judgement_owed ?? 0
		},
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

// The lane room, each read answered from the script's queue, the last answer repeating.
function room_ports(script: Script): Pick<LoopPorts, 'free_lanes' | 'limit_room' | 'has_lane'> {
	const free = [...(script.free_lanes ?? [ROOMY_POOL])]
	const room = [...(script.limit_room ?? script.free_lanes ?? [ROOMY_POOL])]

	return {
		free_lanes: async () => (free.length > 1 ? free.shift() : free[0]) ?? ROOMY_POOL,
		limit_room: async () => (room.length > 1 ? room.shift() : room[0]) ?? ROOMY_POOL,
		has_lane: async (issue) => script.kept_lanes?.includes(issue) === true,
	}
}

// The memory hold, answered from the script's queue, the last answer repeating.
function memory_port(script: Script): Pick<LoopPorts, 'memory_held'> {
	const memory = [...(script.memory_held ?? [false])]

	return {
		memory_held: async () => (memory.length > 1 ? memory.shift() : memory[0]) ?? false,
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

// The reports an offered pass leaves, kept for the suite to read.
function report_ports(
	holds: Array<string | undefined>,
	idles: Array<DriveState>,
): Pick<LoopPorts, 'hold' | 'idle'> {
	return {
		hold: async (reason) => {
			holds.push(reason)
		},
		idle: async (idle_state) => {
			idles.push(idle_state)
		},
	}
}

function harness(script: Script): Harness {
	const calls: Array<string> = []
	const offers: Array<DriveState> = []
	const states: Array<DriveState> = []
	const holds: Array<string | undefined> = []
	const idles: Array<DriveState> = []

	return {
		calls,
		offers,
		states,
		holds,
		idles,
		ports: {
			...child_ports(script, calls),
			...dispatch_ports(script, calls, offers),
			...room_ports(script),
			...memory_port(script),
			...loop_ports(calls, states),
			...report_ports(holds, idles),
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
