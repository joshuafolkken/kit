import type { RunEvent } from '#scripts/run/run-event-stream'
import { describe, expect, it } from 'vitest'
import { backlog_budget } from './backlog-budget'
import {
	backlog_drive,
	type ChildResult,
	type DriveOffer,
	type DrivePorts,
	type DriveState,
	type OfferAsk,
} from './backlog-drive'

// joshuafolkken/kit#2508: `backlog:drive` end to end over a fixture world — a scripted backlog, a lane
// count, per-child merge answers and a clock — with the real `backlog_budget.decide` in the offer, so
// the four paths the acceptance criteria name are each driven the way production drives them: a clean
// drain to the report, a park, a restart after a kill, and the maximum reached.

const START_MS = 0
const AT = '2026-09-24T00:00:00.000Z'
const MERGED: ChildResult = { outcome: 'merged', token: 'none' }
const ONE = '1'
const TWO = '2'
const THREE = '3'

interface World {
	backlog: Array<string>
	lanes: number
	merged: number
	max_issues: number | undefined
	idle_budget_ms: number | undefined
	answers: Record<string, ChildResult>
	events: Array<RunEvent>
	calls: Array<string>
	clock_ms: number
	is_drained: boolean
}

function world_of(backlog: ReadonlyArray<string>, overrides: Partial<World> = {}): World {
	return {
		backlog: [...backlog],
		lanes: 2,
		merged: 0,
		max_issues: undefined,
		idle_budget_ms: undefined,
		answers: {},
		events: [],
		calls: [],
		clock_ms: START_MS,
		is_drained: false,
		...overrides,
	}
}

function record(world: World, kind: string, text: string): void {
	world.events.push({ pos: world.events.length, at: AT, kind, text })
}

function candidates(world: World, ask: OfferAsk, running: ReadonlyArray<string>): Array<string> {
	const free = world.backlog.filter((issue) => !running.includes(issue))

	return free.filter((issue) => !ask.excludes.includes(issue)).slice(0, world.lanes - ask.running)
}

function answer_of(issues: ReadonlyArray<string>, running: number): DriveOffer['answer'] {
	if (issues.length > 0) return 'candidates'

	return running > 0 ? 'blocked' : 'exhausted'
}

function offer(world: World, ask: OfferAsk, running: ReadonlyArray<string>): DriveOffer {
	const issues = candidates(world, ask, running)
	const input = {
		answer: answer_of(issues, ask.running),
		merged: world.merged,
		running: ask.running,
		started_at_ms: START_MS,
		active_at_ms: ask.active_at_ms,
		now_ms: world.clock_ms,
		max_issues: world.max_issues,
		idle_budget_ms: world.idle_budget_ms,
	}
	const decision = backlog_budget.decide(input)

	return {
		...decision,
		answer: input.answer,
		issues,
		retries: 0,
		is_finish: backlog_budget.is_finish(input),
	}
}

function merge(world: World, issue: string): ChildResult {
	const result = world.answers[issue] ?? MERGED

	world.calls.push(`merge ${issue}`)

	if (result.outcome === 'merged') {
		world.merged += 1
		world.backlog = world.backlog.filter((child) => child !== issue)
		record(world, 'merge', `#${issue} merged`)
	}

	return result
}

// `running` stands in for the lanes this driver's launches hold, and `alive` for their processes; the
// fixture's children end the moment they are awaited.
function ports_of(world: World, alive: Set<string>): DrivePorts {
	const running: Array<string> = []

	return {
		offer: async (ask) => offer(world, ask, running),
		launch: async (issue) => {
			world.calls.push(`launch ${issue}`)
			running.push(issue)
			alive.add(issue)
			record(world, 'child-launch', `#${issue} dispatched`)

			return true
		},
		is_running: (issue) => alive.has(issue),
		await_any: async (issues) => {
			alive.delete(issues[0] ?? '')

			return issues[0] ?? ''
		},
		merge: async (issue) => merge(world, issue),
		mark_drain: async () => !world.is_drained && (world.is_drained = true),
		finish: async () => {
			world.calls.push('finish')
		},
		sleep: async (milliseconds) => {
			world.clock_ms += milliseconds
		},
		now: () => world.clock_ms,
	}
}

function fresh(): DriveState {
	return backlog_drive.restore([], [], START_MS)
}

function count(world: World, call: string): number {
	return world.calls.filter((made) => made === call).length
}

async function verdict_of(ports: DrivePorts, state: DriveState): Promise<string> {
	const stop = await backlog_drive.drive(ports, state)

	return stop.verdict
}

describe('backlog:drive harness — the path with no judgement', () => {
	it('drains the backlog through every lane and ends at the report', async () => {
		const world = world_of(['1', '2', '3'])
		const stop = await backlog_drive.drive(ports_of(world, new Set()), fresh())

		expect(backlog_drive.line_of(stop)).toBe(`done ${backlog_budget.NO_IDLE_WATCH_REASON}`)
		expect(world.calls.filter((call) => call.startsWith('launch'))).toStrictEqual([
			'launch 1',
			'launch 2',
			'launch 3',
		])
		expect(world.calls.filter((call) => call.startsWith('merge'))).toHaveLength(3)
		expect(world.calls.at(-1)).toBe('finish')
	})

	it('stops once at the first drain, then watches out the idle budget on the next run', async () => {
		const idle_budget_ms = backlog_drive.WATCH_POLL_MS
		const world = world_of([], { idle_budget_ms })
		const ports = ports_of(world, new Set())

		expect(await verdict_of(ports, fresh())).toBe('drain')
		expect(await verdict_of(ports, fresh())).toBe('done')
		expect(world.clock_ms).toBe(idle_budget_ms)
	})
})

describe('backlog:drive harness — a judgement branch', () => {
	it('stops at a parked child with its number and does not report', async () => {
		const world = world_of(['1', '2'], { answers: { [TWO]: { outcome: 'parked', token: THREE } } })
		const stop = await backlog_drive.drive(ports_of(world, new Set()), fresh())

		expect(backlog_drive.line_of(stop)).toBe('park #2')
		expect(world.calls).not.toContain('finish')
	})

	it('stops with the message when a port throws, rather than crashing', async () => {
		const ports: DrivePorts = {
			...ports_of(world_of([ONE]), new Set()),
			await_any: async () => {
				throw new Error('lane child 1 never appeared within 600s')
			},
		}
		const stop = await backlog_drive.drive(ports, fresh())

		expect(backlog_drive.line_of(stop)).toBe('error lane child 1 never appeared within 600s')
	})

	it('stops at the maximum once the wave already started has merged', async () => {
		const world = world_of(['1', '2', '3'], { lanes: 1, max_issues: 1, idle_budget_ms: 1 })
		const stop = await backlog_drive.drive(ports_of(world, new Set()), fresh())

		expect(stop.verdict).toBe('stopped')
		expect(stop.detail).toBe(backlog_budget.max_reached_reason(1, 1))
		expect(world.calls).toStrictEqual(['launch 1', 'merge 1', 'finish'])
	})
})

describe('backlog:drive harness — a restart after a kill', () => {
	it('neither relaunches nor re-merges, and merges the child that ended unwatched', async () => {
		const over: ChildResult = { outcome: 'merged', token: 'over' }
		const world = world_of([ONE, TWO], { answers: { [ONE]: over } })
		const alive = new Set<string>()

		expect(await verdict_of(ports_of(world, alive), fresh())).toBe('over')

		world.answers = {}
		alive.clear()
		const restored = backlog_drive.restore([ONE, TWO], world.events, world.clock_ms)

		expect(await verdict_of(ports_of(world, alive), restored)).toBe('done')
		expect([
			count(world, 'launch 2'),
			count(world, 'merge 1'),
			count(world, 'merge 2'),
		]).toStrictEqual([1, 1, 1])
	})
})
