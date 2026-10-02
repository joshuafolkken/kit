import { backlog_drive, type DriveState, type LoopPorts, type OfferRead } from './backlog-drive'

// The scripted ports every `backlog_drive` suite drives the loop through — one copy, so the suites
// cannot drift on how a child finishes, a merge answers or an offer is queued (joshuafolkken/kit#2881).

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

interface Harness {
	ports: LoopPorts
	calls: Array<string>
	offers: Array<DriveState>
	states: Array<DriveState>
}

interface Script {
	finished?: ReadonlyArray<string>
	merges?: ReadonlyMap<string, string>
	offers?: ReadonlyArray<OfferRead | undefined>
	failed_launches?: ReadonlyArray<string>
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

			return script.merges?.get(issue) ?? NEXT_TOKEN
		},
	}
}

// The dispatch-facing ports: offers answer from the script's queue, then `wait`.
function dispatch_ports(
	script: Script,
	calls: Array<string>,
	offers: Array<DriveState>,
): Pick<LoopPorts, 'offer' | 'launch'> {
	const queue = [...(script.offers ?? [])]

	return {
		offer: async (asked) => {
			calls.push('offer')
			offers.push(asked)

			return queue.length === 0 ? offer('wait') : queue.shift()
		},
		launch: async (issue) => {
			calls.push(`launch ${issue}`)

			return !(script.failed_launches ?? []).includes(issue)
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
