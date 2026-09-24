import type { RunEvent } from '#scripts/run/run-event-stream'
import { expect, it } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive, type DriveState, type LoopPorts, type OfferRead } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'

const START = '2026-09-24T00:00:00.000Z'
const START_MS = Date.parse(START)
const POLL_MS = 5000
const OFFER_MS = 60_000
const FIRST = '1'
const SECOND = '2'
const THIRD = '3'
const REPORT_END = 'report and end'
const REPORT_STOP = 'report and stop'
const NO_WINDOW = { poll_ms: POLL_MS, offer_ms: OFFER_MS, window_ms: undefined }

interface World {
	backlog: Array<string>
	parked: ReadonlySet<string>
	merged: number
	max: number | undefined
	clock: number
	calls: Array<string>
}

function world(backlog: ReadonlyArray<string>, parked: ReadonlyArray<string> = []): World {
	return {
		backlog: [...backlog],
		parked: new Set(parked),
		merged: 0,
		max: undefined,
		clock: START_MS,
		calls: [],
	}
}

function offer(world_state: World, state: DriveState): OfferRead {
	const available = world_state.backlog.filter((issue) => !state.in_flight.includes(issue))
	const answer = available.length > 0 ? 'candidates' : 'exhausted'
	const input = {
		answer,
		merged: world_state.merged,
		running: state.in_flight.length,
		started_at_ms: START_MS,
		active_at_ms: Date.parse(state.active),
		now_ms: world_state.clock,
		max_issues: world_state.max,
		idle_budget_ms: undefined,
	} as const
	const decision = backlog_budget.decide(input)

	return {
		verdict: decision.verdict,
		issues: available.slice(0, 1),
		retries: 0,
		reason: decision.reason,
		is_finish: backlog_budget.is_finish(input),
	}
}

function merge(world_state: World, issue: string): void {
	world_state.calls.push(`merge ${issue}`)
	world_state.backlog = world_state.backlog.filter((item) => item !== issue)
	if (world_state.parked.has(issue)) return

	world_state.merged += 1
}

function ports(world_state: World): LoopPorts {
	return {
		is_finished: () => true,
		merge: async (issue) => {
			merge(world_state, issue)

			return 'none'
		},
		offer: async (state) => offer(world_state, state),
		launch: async (issue) => {
			world_state.calls.push(`launch ${issue}`)

			return true
		},
		now: () => new Date(world_state.clock),
		sleep: async (milliseconds) => {
			world_state.clock += milliseconds
		},
		on_state: () => undefined,
		finish: async (end) => {
			world_state.calls.push(end.is_finish === true ? REPORT_END : REPORT_STOP)
		},
	}
}

function initial(in_flight: ReadonlyArray<string> = []): DriveState {
	return backlog_drive.initial_state(in_flight, START)
}

function event(pos: number, kind: string, text: string): RunEvent {
	return { pos, kind, text, at: START }
}

it('dispatches and merges every child, then reports and ends', async () => {
	const fixture = world([FIRST, SECOND])
	const end = await backlog_drive.run_loop(initial(), NO_WINDOW, ports(fixture))

	expect(end.reason).toBe('stop')
	expect(fixture.calls).toStrictEqual([
		`launch ${FIRST}`,
		`merge ${FIRST}`,
		`launch ${SECOND}`,
		`merge ${SECOND}`,
		REPORT_END,
	])
})

it('records a parked child and continues to the next child', async () => {
	const fixture = world([FIRST, SECOND], [FIRST])
	const end = await backlog_drive.run_loop(initial(), NO_WINDOW, ports(fixture))

	expect(end.reason).toBe('stop')
	expect(fixture.calls).toContain(`launch ${SECOND}`)
	expect(fixture.merged).toBe(1)
})

it('restores only this invocation’s active lane after a kill', async () => {
	const fixture = world([FIRST])
	const cut = { ...NO_WINDOW, window_ms: 0 }
	const first = await backlog_drive.run_loop(initial(), cut, ports(fixture))
	const events = [event(1, 'child-launch', '#1 dispatched')]
	const lanes = backlog_drive_restore.restore([FIRST, THIRD], events, [])
	const resumed = await backlog_drive.run_loop(initial(lanes), NO_WINDOW, ports(fixture))

	expect([first.reason, resumed.reason]).toStrictEqual(['window', 'stop'])
	expect(fixture.calls).toStrictEqual([`launch ${FIRST}`, `merge ${FIRST}`, REPORT_END])
})

it('stops launching at the declared maximum and reports', async () => {
	const fixture = world([FIRST, SECOND])

	fixture.max = 1
	const end = await backlog_drive.run_loop(initial(), NO_WINDOW, ports(fixture))

	expect(end.reason).toBe('stop')
	expect(fixture.calls).toStrictEqual([`launch ${FIRST}`, `merge ${FIRST}`, REPORT_STOP])
})
