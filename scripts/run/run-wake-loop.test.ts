import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_wake, type RunWake } from './run-wake'
import { run_wake_loop, type LoopPorts } from './run-wake-loop'
import type { LaunchResult } from './run-wake-session'

// joshuafolkken/kit#1719. The loop is where "one wake per cut" either holds or does not, and no test
// of the decision alone can see it: what matters is what the supervisor writes back between passes.

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'
const LAUNCHED: LaunchResult = { kind: 'launched', pid: 4242 }

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 3,
		filed: 1,
		cuts: 2,
		...overrides,
	}
}

const HANDED_OFF: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }
const IN_FLIGHT: CarryRead = { kind: 'carried', carry: carry() }
const ENDED: CarryRead = { kind: 'none' }
const FAILED = 'failed'
const ENOENT_NOTE = 'spawn claude ENOENT'

interface Recorder {
	ports: LoopPorts
	wakes: Array<string>
}

// A scripted sequence of carry reads, one per pass, so a whole run of the supervisor is expressed as
// what the record said over time. Running past the end reads as the run having ended.
function recorder(reads: ReadonlyArray<CarryRead>, launch: LaunchResult = LAUNCHED): Recorder {
	const wakes: Array<string> = []
	const remaining = [...reads]

	return {
		wakes,
		ports: {
			read_carry: () => remaining.shift() ?? ENDED,
			// The ordinary case: `--cut` is the cutting session's last write and its process is gone.
			is_owner_live: () => false,
			wake: (invocation) => {
				wakes.push(invocation)

				return launch
			},
			sleep: async () => {
				await Promise.resolve()
			},
			now: () => NOW,
		},
	}
}

const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-loop-test-'))
	scratch.target = path.join(scratch.directory, 'wake.json')
	run_wake.write_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))
})

afterEach(() => {
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('run_wake_loop.run_loop — one wake per cut', () => {
	it('wakes once for one cut, and not again while the wake is pending', async () => {
		const scripted = recorder([HANDED_OFF, HANDED_OFF, HANDED_OFF, ENDED])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(scripted.wakes).toStrictEqual([INVOCATION])
	})

	it('wakes again for the next cut once the previous session claimed the record', async () => {
		const scripted = recorder([HANDED_OFF, IN_FLIGHT, HANDED_OFF, ENDED])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(scripted.wakes).toStrictEqual([INVOCATION, INVOCATION])
	})

	// The count is what the completion report names beside the carry record's `cuts`, so it has to
	// survive the passes between wakes rather than being recomputed.
	it('counts every wake into its own record', async () => {
		const scripted = recorder([HANDED_OFF, IN_FLIGHT, HANDED_OFF, IN_FLIGHT])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(run_wake.read_wake(scratch.target)?.woke).toBe(2)
	})
})

describe('run_wake_loop.run_loop — where it stops', () => {
	it('stops on an expired record without waking anything', async () => {
		const scripted = recorder([{ kind: 'expired', carry: carry({ is_handed_off: true }) }])

		const stop = await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(stop.reason).toBe('expired')
		expect(scripted.wakes).toStrictEqual([])
	})

	it('stops when the run ends', async () => {
		const stop = await run_wake_loop.run_loop(scratch.target, recorder([ENDED]).ports, 0)

		expect(stop.reason).toBe('ended')
	})

	it('stops rather than guessing when the carry record cannot be read', async () => {
		const stop = await run_wake_loop.run_loop(
			scratch.target,
			recorder([{ kind: 'unreadable' }]).ports,
			0,
		)

		expect(stop.reason).toBe('unreadable')
	})

	// Removing the record is how `--stop` reaches a supervisor whose process cannot be signalled.
	it('ends when its own record is removed', async () => {
		run_wake.remove_wake(scratch.target)

		const stop = await run_wake_loop.run_loop(scratch.target, recorder([HANDED_OFF]).ports, 0)

		expect(stop.reason).toBe('stopped')
	})
})

describe('run_wake_loop.run_loop — a failure that must not be silent', () => {
	it('reports a launch that could not start, with the reason attached', async () => {
		const failure: LaunchResult = { kind: 'failed', note: ENOENT_NOTE }
		const scripted = recorder([HANDED_OFF], failure)

		const stop = await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(stop.reason).toBe(FAILED)
		expect(stop.note).toBe(ENOENT_NOTE)
	})

	// The grace window is the launch-failure detector, so a session that started and never claimed the
	// record has to surface as a failure rather than as a supervisor waiting forever.
	it('reports a wake that never claimed the carry record, once the retries are spent', async () => {
		const stale: RunWake = {
			...run_wake.fresh_wake(INVOCATION, NOW),
			woke: 1,
			attempts: run_wake.MAX_WAKE_ATTEMPTS,
			woke_pid: 777,
			woke_at: new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS * 2).toISOString(),
		}

		run_wake.write_wake(scratch.target, stale)

		const stop = await run_wake_loop.run_loop(scratch.target, recorder([HANDED_OFF]).ports, 0)

		expect(stop.reason).toBe(FAILED)
		expect(stop.note).toContain(INVOCATION)
		// Named rather than killed: a merely slow session is still doing the run's work.
		expect(stop.note).toContain('777')
	})

	// Ending the whole overnight run on one slow start is the expensive mistake, so a lost wake is
	// retried first — and the retry must not inflate the published `woke == cuts` invariant.
	it('retries a lost wake without counting it as a second cut served', async () => {
		run_wake.write_wake(scratch.target, {
			...run_wake.fresh_wake(INVOCATION, NOW),
			woke: 1,
			attempts: 1,
			woke_at: new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS * 2).toISOString(),
		})

		const scripted = recorder([HANDED_OFF, ENDED])

		await run_wake_loop.run_loop(scratch.target, scripted.ports, 0)

		expect(scripted.wakes).toStrictEqual([INVOCATION])
		expect(run_wake.read_wake(scratch.target)?.woke).toBe(1)
	})
})
