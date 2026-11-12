import type { HoldRead } from '#scripts/run/hold/run-hold'
import { describe, expect, it, vi } from 'vitest'
import { run_stale, type StalePorts, type StaleVerdict } from './run-stale'

const ISSUE = 42
const OTHER_ISSUE = 7
const LANE = '/lanes/42'
const NOW = new Date('2026-11-01T12:00:00Z')
const STALE_AT = '2026-11-01T09:00:00Z'
const FRESH_AT = '2026-11-01T11:30:00Z'
const FAILURE_EXIT_CODE = 1

function held(issue: number): HoldRead {
	return { kind: 'held', hold: { issue: String(issue), taken_at: STALE_AT, pid: 1 } }
}

function ports(overrides: Partial<StalePorts> = {}): StalePorts {
	return {
		now: () => NOW,
		read_holders: vi.fn(async () => [ISSUE]),
		read_labeled_at: vi.fn(async () => ({ kind: 'at' as const, at: STALE_AT })),
		checkout_of: vi.fn(async () => LANE),
		read_hold: vi.fn(async (): Promise<HoldRead> => ({ kind: 'free' })),
		is_tree_dirty: vi.fn(async () => false),
		has_residents: vi.fn(() => false),
		unmark: vi.fn(async () => true),
		...overrides,
	}
}

async function judged(live: StalePorts): Promise<StaleVerdict> {
	return await run_stale.judge(ISSUE, live)
}

const UNREAD_LISTING = { read_holders: vi.fn(async () => undefined) }
const EMPTY_LISTING = { read_holders: vi.fn(async () => []) }

describe('run_stale.judge — kept', () => {
	it('keeps a label inside the window without touching the checkout', async () => {
		const live = ports({
			read_labeled_at: vi.fn(async () => ({ kind: 'at' as const, at: FRESH_AT })),
		})
		const verdict = await judged(live)

		expect(verdict).toEqual({ issue: ISSUE, action: 'kept', reason: 'in-progress for 30 min' })
		expect(live.checkout_of).not.toHaveBeenCalled()
	})

	it('keeps a label whose timeline could not be read', async () => {
		const live = ports({ read_labeled_at: vi.fn(async () => ({ kind: 'unread' as const })) })
		const verdict = await judged(live)

		expect(verdict.action).toBe('kept')
		expect(live.unmark).not.toHaveBeenCalled()
	})

	it('keeps a stale label whose checkout has uncommitted changes, naming the reason', async () => {
		const live = ports({ is_tree_dirty: vi.fn(async () => true) })
		const verdict = await judged(live)

		expect(verdict.action).toBe('kept')
		expect(verdict.reason).toContain(`uncommitted changes in ${LANE}`)
		expect(live.unmark).not.toHaveBeenCalled()
	})

	it('keeps a stale label a live run record for the issue holds', async () => {
		const live = ports({ read_hold: vi.fn(async () => held(ISSUE)) })
		const verdict = await judged(live)

		expect(verdict.reason).toContain(`a live run holds ${LANE}`)
		expect(live.unmark).not.toHaveBeenCalled()
	})
})

describe('run_stale.judge — kept by what runs in the checkout', () => {
	it('keeps a stale label while a process such as a detached ship runs from the checkout', async () => {
		const live = ports({ has_residents: vi.fn(() => true) })
		const verdict = await judged(live)

		expect(verdict.reason).toContain(`a process still runs from ${LANE}`)
		expect(live.has_residents).toHaveBeenCalledWith(ISSUE, LANE)
	})

	it('keeps a stale label an expired prrun stop record for the issue holds', async () => {
		const stopped: HoldRead = {
			kind: 'stale',
			hold: { issue: String(ISSUE), taken_at: STALE_AT, pid: 1, prrun_stop_head: 'abc' },
		}
		const verdict = await judged(ports({ read_hold: vi.fn(async () => stopped) }))

		expect(verdict.reason).toContain(`a live run holds ${LANE}`)
	})

	it('removes a stale label whose expired record is not a stop', async () => {
		const expired: HoldRead = {
			kind: 'stale',
			hold: { issue: String(ISSUE), taken_at: STALE_AT, pid: 1 },
		}
		const verdict = await judged(ports({ read_hold: vi.fn(async () => expired) }))

		expect(verdict.action).toBe('removed')
	})

	it('keeps a stale label whose checkout record cannot be read', async () => {
		const unreadable: HoldRead = { kind: 'unreadable' }
		const verdict = await judged(ports({ read_hold: vi.fn(async () => unreadable) }))

		expect(verdict.action).toBe('kept')
	})
})

describe('run_stale.judge — removed', () => {
	it('reports a refused removal as kept', async () => {
		const verdict = await judged(ports({ unmark: vi.fn(async () => false) }))

		expect(verdict.reason).toBe('in-progress for 180 min — stale; the removal was refused')
		expect(verdict.action).toBe('kept')
	})

	it('removes a stale label when the clean checkout is held for another issue', async () => {
		const live = ports({ read_hold: vi.fn(async () => held(OTHER_ISSUE)) })
		const verdict = await judged(live)

		expect(verdict.action).toBe('removed')
		expect(live.unmark).toHaveBeenCalledWith(ISSUE)
	})

	it('removes a stale label with no checkout at all', async () => {
		const live = ports({ checkout_of: vi.fn(async () => undefined) })
		const verdict = await judged(live)

		expect(verdict.action).toBe('removed')
		expect(live.is_tree_dirty).not.toHaveBeenCalled()
	})
})

describe('run_stale.run', () => {
	it('fails when the listing cannot be read', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(await run_stale.run(ports(UNREAD_LISTING))).toBe(FAILURE_EXIT_CODE)
		expect(error).toHaveBeenCalledOnce()
		error.mockRestore()
	})

	it('prints one line per issue and succeeds', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await run_stale.run(ports())).toBe(0)
		expect(info).toHaveBeenCalledOnce()
		expect(String(info.mock.calls[0]?.[0])).toContain('removed — in-progress for 180 min — stale')
		info.mockRestore()
	})

	it('says so when no issue carries the label', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(await run_stale.run(ports(EMPTY_LISTING))).toBe(0)
		expect(String(info.mock.calls[0]?.[0])).toContain('no open issue carries')
		info.mockRestore()
	})
})
