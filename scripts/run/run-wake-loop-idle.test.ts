import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_wake } from './run-wake'
import { run_wake_loop, type LoopPorts } from './run-wake-loop'
import type { LaunchResult } from './run-wake-session'

// joshuafolkken/kit#2417. The loop is where "no work, no launch" and the back-off either hold or do
// not: what matters is what it launches and how long it sleeps between passes.

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const INTERVAL_MS = 60_000
const MS_PER_SECOND = 1000

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

// Each sleep advances the clock by what was slept, so the back-off is measured the way it runs.
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
		const passes = Math.ceil(run_wake.IDLE_CEILING_MS / INTERVAL_MS) + 1
		const reads = [...Array.from({ length: passes }, () => HANDED_OFF), ENDED]
		const scripted = recorder(reads, [])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		const idle_for = (scripted.wake_times[0] ?? NOW.getTime()) - NOW.getTime()
		const cap = INTERVAL_MS * run_wake_loop.MAX_BACKOFF_FACTOR

		expect(idle_for).toBeGreaterThan(run_wake.IDLE_CEILING_MS)
		expect(idle_for).toBeLessThanOrEqual(run_wake.IDLE_CEILING_MS + cap)
	})
})

describe('run_wake_loop.run_loop — backing off after repeated whiffs', () => {
	it('stretches the interval while idle, capped at the back-off factor', async () => {
		const reads = [...Array.from({ length: 6 }, () => HANDED_OFF), ENDED]
		const scripted = recorder(reads, [])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		const cap = INTERVAL_MS * run_wake_loop.MAX_BACKOFF_FACTOR
		const expected = [60, 60, 120, 240, 480, 480].map((seconds) => seconds * MS_PER_SECOND)

		expect(scripted.sleeps).toStrictEqual(expected)
		expect(Math.max(...scripted.sleeps)).toBe(cap)
	})

	it('polls at the configured interval when nothing is idle', () => {
		const wake = run_wake.fresh_wake(INVOCATION, NOW)

		expect(run_wake_loop.next_interval(wake, INTERVAL_MS, NOW)).toBe(INTERVAL_MS)
	})

	it('returns to the configured interval once a launch clears the idle mark', async () => {
		const reads = [...Array.from({ length: 5 }, () => HANDED_OFF), IN_FLIGHT, ENDED]
		const scripted = recorder(reads, [false, false, false, false, true])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, INTERVAL_MS)

		const expected = [60, 60, 120, 240, 60, 60].map((seconds) => seconds * MS_PER_SECOND)

		expect(scripted.wakes).toStrictEqual([INVOCATION])
		expect(scripted.sleeps).toStrictEqual(expected)
	})
})
