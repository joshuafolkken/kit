import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const unmoved_mock = vi.hoisted(() => vi.fn(() => true))

vi.mock('#scripts/gate/scoped-green', () => ({ scoped_green: { is_unmoved: unmoved_mock } }))

const { run_ship_pair_runs } = await import('./run-ship-pair-runs')

// joshuafolkken/kit#5538: which run of a ship's scoped pair started checks, and why one ran again.

const TREE = { files: {}, base: 'base' }
const OK = 0
const FAILED = 1

beforeEach(() => {
	unmoved_mock.mockReset().mockReturnValue(true)
	run_ship_pair_runs.forget()
})

describe('run_ship_pair_runs.begin', () => {
	it('counts the first run without a reason or a log line', () => {
		expect(run_ship_pair_runs.begin(TREE)).toBeUndefined()
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 1 })
	})

	it('names no reason on the first run after a pair that ran nothing', () => {
		run_ship_pair_runs.met(TREE, OK)
		unmoved_mock.mockReturnValue(false)

		expect(run_ship_pair_runs.begin(TREE)).toBeUndefined()
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 1 })
	})

	it('names a run after a pair on a tree that moved since', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, OK)
		unmoved_mock.mockReturnValue(false)

		expect(run_ship_pair_runs.begin(TREE)).toBe('scoped pair run 2 (moved)')
		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'moved' })
	})

	it('names a run after a red pair on the same tree a recheck', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, FAILED)

		run_ship_pair_runs.begin(TREE)

		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'recheck' })
	})

	it('names a run after a green pair on the same tree that left no record', () => {
		run_ship_pair_runs.begin(TREE)
		run_ship_pair_runs.met(TREE, OK)

		run_ship_pair_runs.begin(TREE)

		expect(run_ship_pair_runs.current()).toStrictEqual({ runs: 2, rerun: 'no-record' })
	})
})

// joshuafolkken/kit#7053: round 2 reran a pair the gate stage had just met red on the same tree.
// The red a pair ahead met while this turn waited, read from inside the turn.
async function red_after(code: number): Promise<ReturnType<typeof run_ship_pair_runs.red_on>> {
	const ahead = run_ship_pair_runs.one_at_a_time(async () => {
		await Promise.resolve()
		run_ship_pair_runs.met(TREE, code, 'red')
	})
	const waited = run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.red_on(TREE))

	await ahead

	return await waited
}

describe('run_ship_pair_runs.red_on', () => {
	it('answers the red result a pair ahead met on the same tree', async () => {
		await expect(red_after(FAILED)).resolves.toStrictEqual({ code: FAILED, out: 'red' })
	})

	it('answers nothing once the tree moved since the red pair', async () => {
		unmoved_mock.mockReturnValue(false)

		await expect(red_after(FAILED)).resolves.toBeUndefined()
	})

	it('answers nothing after a green pair', async () => {
		await expect(red_after(OK)).resolves.toBeUndefined()
	})

	it('answers nothing for a turn that joined the queue after the red pair ended', async () => {
		run_ship_pair_runs.met(TREE, FAILED)

		await expect(
			run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.red_on(TREE)),
		).resolves.toBeUndefined()
	})
})

describe('run_ship_pair_runs.one_at_a_time', () => {
	it('starts a later turn only once the earlier one ended, even when it threw', async () => {
		const order: Array<string> = []
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
			order.push('first')
			throw new Error('red')
		})
		const second = run_ship_pair_runs.one_at_a_time(async () => {
			order.push('second')

			return run_ship_pair_runs.current()
		})

		await expect(first).rejects.toThrow('red')
		expect(await second).toStrictEqual({ queued_ms: expect.any(Number) })
		expect(order).toStrictEqual(['first', 'second'])
	})
})

// joshuafolkken/kit#8864: the wait a pair spent behind another, which its lap does not include.
describe('run_ship_pair_runs.current queued wait', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('records how long a turn queued behind a pair still in its turn', async () => {
		vi.spyOn(performance, 'now')
			.mockReturnValueOnce(0)
			.mockReturnValueOnce(100)
			.mockReturnValue(250)
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
		})
		const second = run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current())

		await first
		expect(await second).toStrictEqual({ queued_ms: 150 })
	})

	it('records no wait for a turn with no pair ahead', async () => {
		await run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
		})

		expect(
			await run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current()),
		).toStrictEqual({})
	})
})

describe('run_ship_pair_runs queued wait reset', () => {
	it('drops the wait of an earlier turn once a later one queued behind none', async () => {
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
		})
		const second = run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current())

		await first
		expect(await second).toStrictEqual({ queued_ms: expect.any(Number) })
		expect(
			await run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current()),
		).toStrictEqual({})
	})

	it('forgets the recorded wait', async () => {
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
		})

		await run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current())
		await first
		run_ship_pair_runs.forget()

		expect(run_ship_pair_runs.current()).toStrictEqual({})
	})

	it('forgets the turns still pending, so the next turn queues behind none', async () => {
		const first = run_ship_pair_runs.one_at_a_time(async () => {
			await Promise.resolve()
		})

		run_ship_pair_runs.forget()
		const second = run_ship_pair_runs.one_at_a_time(async () => run_ship_pair_runs.current())

		await first
		expect(await second).toStrictEqual({})
	})
})
