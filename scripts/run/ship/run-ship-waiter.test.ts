import { randomUUID } from 'node:crypto'
import { stamp_file } from '#scripts/josh/stamp-file'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sleep_mock = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => undefined))

vi.mock('node:timers/promises', () => ({ setTimeout: sleep_mock }))

const { run_ship_waiter } = await import('./run-ship-waiter')

// joshuafolkken/kit#4711: a stopped ship goes back to the lane session still waiting on it, and to a
// fresh session only where none waits.

const ISSUE = '4711'
const NOTE = 'Read the stopped report, fix the review failure, then ship again'

function repository(): string {
	return `/repositories/${randomUUID()}`
}

afterEach(() => {
	sleep_mock.mockReset()
	sleep_mock.mockImplementation(async () => undefined)
})

describe('run_ship_waiter.offer', () => {
	it('offers nothing where no session waits, so the lane relaunches at once', async () => {
		const root = repository()

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(false)
		expect(sleep_mock).not.toHaveBeenCalled()
		expect(run_ship_waiter.take(root, ISSUE)).toBeUndefined()
	})

	it('hands the note to the waiting session, which takes it once', async () => {
		const root = repository()
		const taken: Array<string | undefined> = []

		run_ship_waiter.beat(root, ISSUE)
		sleep_mock.mockImplementation(async () => {
			taken.push(run_ship_waiter.take(root, ISSUE))
		})

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(true)
		expect(taken[0]).toBe(NOTE)
		expect(run_ship_waiter.take(root, ISSUE)).toBeUndefined()
	})

	it('withdraws a note nobody took within the session gap, so the lane relaunches', async () => {
		const root = repository()

		run_ship_waiter.beat(root, ISSUE)

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(false)
		expect(sleep_mock).toHaveBeenCalled()
		expect(run_ship_waiter.take(root, ISSUE)).toBeUndefined()
	})
})

describe('run_ship_waiter.offer at the end of the session gap', () => {
	it('reads a note taken on the last poll of the session gap as taken, not withdrawn', async () => {
		const root = repository()

		run_ship_waiter.beat(root, ISSUE)
		await run_ship_waiter.offer(root, ISSUE, NOTE)
		const last_poll = sleep_mock.mock.calls.length

		sleep_mock.mockClear()
		sleep_mock.mockImplementation(async () => {
			if (sleep_mock.mock.calls.length === last_poll) run_ship_waiter.take(root, ISSUE)
		})

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(true)
	})

	it('keeps a withdrawn note from a waiter that read it just before the withdrawal', async () => {
		const root = repository()
		const handoff = stamp_file.stamp_path(`josh-ship-handoff-${ISSUE}-`, root)

		run_ship_waiter.beat(root, ISSUE)

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(false)
		stamp_file.replace_stamp(handoff, { at: Date.now(), note: NOTE })
		expect(run_ship_waiter.take(root, ISSUE)).toBeUndefined()
		stamp_file.remove_stamp(handoff)
	})
})

describe('run_ship_waiter.take', () => {
	it('leaves a note older than the session gap, which a supervisor that died mid-offer left behind', async () => {
		const root = repository()
		const taken: Array<string | undefined> = []

		run_ship_waiter.beat(root, ISSUE)
		sleep_mock.mockImplementation(async () => {
			taken.push(run_ship_waiter.take(root, ISSUE, Date.now() + run_ship_waiter.SESSION_GAP_MS))
		})

		await expect(run_ship_waiter.offer(root, ISSUE, NOTE)).resolves.toBe(false)
		expect(taken.length).toBeGreaterThan(0)
		expect(taken.every((note) => note === undefined)).toBe(true)
	})
})

describe('run_ship_waiter.is_waited', () => {
	it('reads a heartbeat within the session gap as a waiting session', () => {
		const root = repository()
		const now = Date.now()

		run_ship_waiter.beat(root, ISSUE, now)

		expect(run_ship_waiter.is_waited(root, ISSUE, now + run_ship_waiter.SESSION_GAP_MS - 1)).toBe(
			true,
		)
		expect(run_ship_waiter.is_waited(root, ISSUE, now + run_ship_waiter.SESSION_GAP_MS)).toBe(false)
	})

	it('reads no session once the wait left for good', () => {
		const root = repository()

		run_ship_waiter.beat(root, ISSUE)
		run_ship_waiter.leave(root, ISSUE)

		expect(run_ship_waiter.is_waited(root, ISSUE)).toBe(false)
	})
})
