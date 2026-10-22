import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { CarryRead, RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { run_wake } from './run-wake'
import { run_wake_loop, type LoopPorts } from './run-wake-loop'
import type { LaunchResult } from './run-wake-session'

// joshuafolkken/kit#2417. The loop is where "no work, no launch" either holds or does not: what
// matters is what it launches and how long it sleeps between passes.

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const INTERVAL_MS = 60_000
// Long enough that the retired back-off would have reached its eight-fold cap.
const IDLE_PASSES = 12
const PASSES_PAST_CEILING = 2

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 3,
		filed: 1,
		cuts: 2,
		failures: 0,
		outages: 0,
		...overrides,
	}
}

const HANDED_OFF: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }
const IN_FLIGHT: CarryRead = { kind: 'carried', carry: carry() }
const ENDED: CarryRead = { kind: 'none' }
const LAUNCHED: LaunchResult = { kind: 'launched', pid: 4242 }

interface Recorder {
	ports: LoopPorts
	wakes: Array<string>
	// The clock reading at each launch, so a test can say *when* the ceiling woke a session.
	wake_times: Array<number>
	sleeps: Array<number>
	work_asks: Array<CarryRead>
}

// Each sleep advances the clock by what was slept, so the idle stretch is measured the way it runs.
function recorder(reads: ReadonlyArray<CarryRead>, work: ReadonlyArray<boolean>): Recorder {
	const wakes: Array<string> = []
	const wake_times: Array<number> = []
	const sleeps: Array<number> = []
	const work_asks: Array<CarryRead> = []
	const remaining = [...reads]
	const answers = [...work]
	const clock = { now: NOW.getTime() }
	const ports: LoopPorts = {
		read_carry: () => remaining.shift() ?? ENDED,
		is_owner_live: (read) => read.kind === 'carried' && read.carry.is_handed_off !== true,
		has_work: async (read) => {
			work_asks.push(read)

			return answers.shift() ?? false
		},
		new_session_id: () => 'sid',
		hand_off: () => undefined,
		drive: async () => ({ kind: 'judgment', material: 'merge over #2500' }),
		wake: (invocation) => {
			wakes.push(invocation)
			wake_times.push(clock.now)

			return LAUNCHED
		},
		sleep: async (milliseconds) => {
			sleeps.push(milliseconds)
			clock.now += milliseconds
			await Promise.resolve()
		},
		now: () => new Date(clock.now),
		retry_closes: async () => undefined,
	}

	return { ports, wakes, wake_times, sleeps, work_asks }
}

const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-loop-idle-test-'))
	scratch.target = path.join(scratch.directory, 'wake.json')
	run_wake.write_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))
})

afterEach(() => {
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('run_wake_loop.run_loop — no work, no launch', () => {
	it('launches nothing for a cut while there is no work', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF, HANDED_OFF, ENDED], [false, false, false])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		expect(scripted.wakes).toStrictEqual([])
	})

	it('launches for the cut once work appears', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF, ENDED], [false, true])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		expect(scripted.wakes).toStrictEqual([INVOCATION])
	})

	// The backlog read is a network call, so it is made only on a pass that would otherwise launch.
	it('does not ask about work while a live session is spending the budget', async () => {
		const scripted = recorder([IN_FLIGHT, IN_FLIGHT, ENDED], [])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		expect(scripted.work_asks).toStrictEqual([])
	})

	// Idle is not a stop: a run whose backlog stays empty is still woken once the ceiling passes, so a
	// session finishes it rather than the record expiring.
	it('wakes a session once the idle stretch outlives the ceiling', async () => {
		// One pass marks the stretch, and the first pass strictly past the ceiling launches.
		const passes = Math.ceil(run_wake.IDLE_CEILING_MS / INTERVAL_MS) + PASSES_PAST_CEILING
		const reads = [...Array.from({ length: passes }, () => HANDED_OFF), ENDED]
		const scripted = recorder(reads, [])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		const idle_for = (scripted.wake_times[0] ?? NOW.getTime()) - NOW.getTime()

		expect(idle_for).toBeGreaterThan(run_wake.IDLE_CEILING_MS)
		expect(idle_for).toBeLessThanOrEqual(run_wake.IDLE_CEILING_MS + INTERVAL_MS)
	})
})

// joshuafolkken/kit#3691: one interval, however long the run has had nothing to do.
describe('run_wake_loop.run_loop — one interval, idle or not', () => {
	it('sleeps the configured interval on every pass of an idle stretch', async () => {
		const reads = [...Array.from({ length: IDLE_PASSES }, () => HANDED_OFF), ENDED]
		const scripted = recorder(reads, [])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		expect(scripted.sleeps).toStrictEqual(Array.from({ length: IDLE_PASSES }, () => INTERVAL_MS))
	})

	it('sleeps the same interval once a launch clears the idle mark', async () => {
		const reads = [...Array.from({ length: 5 }, () => HANDED_OFF), IN_FLIGHT, ENDED]
		const scripted = recorder(reads, [false, false, false, false, true])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		expect(scripted.wakes).toStrictEqual([INVOCATION])
		expect(new Set(scripted.sleeps)).toStrictEqual(new Set([INTERVAL_MS]))
	})
})
