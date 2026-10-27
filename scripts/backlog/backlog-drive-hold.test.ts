import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3995: the driver dispatches the moment a lane frees, and a free lane it leaves
// empty is recorded with why — the offer that started nothing, or the hand-back to a session.

const record_held = vi.hoisted(() => vi.fn(async () => undefined))
const record_released = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('#scripts/lane/lane-ledger-write', () => ({
	lane_ledger_write: { record_held, record_released },
}))

const { backlog_drive } = await import('./backlog-drive')
const { backlog_drive_fixture } = await import('./backlog-drive-fixture')
const { backlog_drive_hold } = await import('./backlog-drive-hold')

const { CONFIG, FIRST_CHILD, OFFERED, POLL_MS, harness, offer, state } = backlog_drive_fixture
const ONE_PASS = { ...CONFIG, window_ms: POLL_MS }
const TWO_PASSES = { ...CONFIG, window_ms: POLL_MS + POLL_MS }
const WAIT_REASON = 'offer:wait'
const CHAIN_REASON = 'offer:watch:chain'
const WAITED_ISSUE = 4496
const WINDOW_END = { reason: 'window', token: undefined, issue: undefined }

async function free(): Promise<number> {
	return 1
}

async function full(): Promise<number> {
	return 0
}

beforeEach(() => {
	record_held.mockClear()
	record_released.mockClear()
})

describe('backlog_drive.run_loop — a freed lane', () => {
	it('offers again in the pass that collected the child, before the offer interval is due', async () => {
		const offers = [offer('wait'), offer('run', [OFFERED])]
		const { ports, calls } = harness({ offers })
		const passes = { count: 0 }

		ports.is_finished = () => {
			passes.count += 1

			return passes.count > 1
		}

		await backlog_drive.run_loop(state([FIRST_CHILD]), TWO_PASSES, ports)

		expect(calls.slice(0, 4)).toStrictEqual([
			'offer',
			`merge ${FIRST_CHILD}`,
			'offer',
			`launch ${OFFERED}`,
		])
	})
})

describe('backlog_drive.run_loop — the holds it reports', () => {
	it('reports an offer that started nothing, with its verdict and answer', async () => {
		const offers = [{ ...offer('wait'), answer: 'blocked' }]
		const { ports, holds } = harness({ offers })

		await backlog_drive.run_loop(state([FIRST_CHILD]), ONE_PASS, ports)

		expect(holds[0]).toBe('offer:wait:blocked')
	})

	// joshuafolkken/kit#4396: a `run:solo` wait is its own reason, apart from every other `blocked`.
	it('reports the offer’s cause in place of its answer', async () => {
		const offers = [{ ...offer('watch'), answer: 'blocked', cause: 'solo' }]
		const { ports, holds } = harness({ offers })

		await backlog_drive.run_loop(state([FIRST_CHILD]), ONE_PASS, ports)

		expect(holds[0]).toBe('offer:watch:solo')
	})

	it('reports the stop verdict as no hold: the run is finishing', async () => {
		const { ports, holds } = harness({ offers: [offer('stop')] })

		await backlog_drive.run_loop(state([FIRST_CHILD]), ONE_PASS, ports)

		expect(holds).toStrictEqual([undefined])
	})

	it('leaves an offer that ended the loop to the hand-back', async () => {
		const { ports, holds } = harness({ offers: [offer('unheard-of')] })

		await backlog_drive.run_loop(state(), ONE_PASS, ports)

		expect(holds).toStrictEqual([])
	})

	it('reports no hold for a pass that launched', async () => {
		const { ports, holds } = harness({ offers: [offer('run', [OFFERED])] })

		await backlog_drive.run_loop(state(), ONE_PASS, ports)

		expect(holds).toStrictEqual([])
	})
})

describe('backlog_drive_hold.hand_back_reason', () => {
	it('names the hand-back that leaves the lanes to a session', () => {
		const end = { reason: 'merge', token: undefined, issue: FIRST_CHILD }

		expect(backlog_drive_hold.hand_back_reason(end)).toBe('hand-back:merge')
	})

	it.each(['stop', 'watch', 'retrospective'])(
		'reads the finished run (%s) as no hold',
		(reason) => {
			const end = { reason, token: reason, issue: undefined }

			expect(backlog_drive_hold.hand_back_reason(end)).toBeUndefined()
		},
	)
})

describe('backlog_drive_hold.recorder — hold', () => {
	it('writes the hold while a lane is free', async () => {
		await backlog_drive_hold.recorder(free).hold(WAIT_REASON)

		expect(record_held).toHaveBeenCalledWith({ reason: WAIT_REASON, waiting: undefined })
	})

	// joshuafolkken/kit#4513: the issues the offer waited on ride into the ledger with the hold.
	it('writes the issues the offer waited on with the hold', async () => {
		await backlog_drive_hold.recorder(free).hold(CHAIN_REASON, [WAITED_ISSUE])

		expect(record_held).toHaveBeenCalledWith({ reason: CHAIN_REASON, waiting: [WAITED_ISSUE] })
	})

	it('hands the offer’s waiting issues to the hold port with its reason', async () => {
		const hold = vi.fn(async () => undefined)
		const read = { ...offer('watch'), answer: 'blocked', cause: 'chain', waiting: [WAITED_ISSUE] }

		await backlog_drive_hold.held({ kind: 'continue', state: state() }, read, { hold })

		expect(hold).toHaveBeenCalledWith(CHAIN_REASON, [WAITED_ISSUE])
	})

	it('releases the open hold once when a lane opened elsewhere fills the pool', async () => {
		const counts = [1, 0, 0]
		const holds = backlog_drive_hold.recorder(async () => counts.shift() ?? 0)

		await holds.hold(WAIT_REASON)
		await holds.hold(WAIT_REASON)
		await holds.hold(WAIT_REASON)

		expect([record_held.mock.calls.length, record_released.mock.calls.length]).toStrictEqual([1, 1])
	})

	it('releases at a driver start, ending a hold an earlier driver left open', async () => {
		await backlog_drive_hold.recorder(full).hold(WAIT_REASON)

		expect(record_released).toHaveBeenCalledOnce()
	})

	it('writes nothing when the free count cannot be read', async () => {
		const holds = backlog_drive_hold.recorder(async () => {
			throw new Error('no lane limit')
		})

		await holds.hold(WAIT_REASON)

		expect([record_held.mock.calls.length, record_released.mock.calls.length]).toStrictEqual([0, 0])
	})
})

describe('backlog_drive_hold.recorder — end', () => {
	it('records the hand-back of a driver end', async () => {
		await backlog_drive_hold.recorder(free).end(WINDOW_END)

		expect(record_held).toHaveBeenCalledWith({ reason: 'hand-back:window', waiting: undefined })
	})

	it('releases the open hold at the finished run, whatever lanes are free', async () => {
		const holds = backlog_drive_hold.recorder(free)

		await holds.hold(WAIT_REASON)
		await holds.end({ reason: 'watch', token: 'watch', issue: undefined })

		expect(record_released).toHaveBeenCalledOnce()
	})

	// A full pool released the hold, then the collected children's parks tripped the merge guard: the
	// stop's release still ends their wait for an offer answer (joshuafolkken/kit#4571).
	it('writes the stop release after a full pool already released the hold', async () => {
		const holds = backlog_drive_hold.recorder(full)

		await holds.hold(WAIT_REASON)
		await holds.hold(undefined)

		expect(record_released).toHaveBeenCalledTimes(2)
	})
})
