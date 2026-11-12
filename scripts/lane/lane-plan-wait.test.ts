import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_plan_signals } from './lane-plan-signals'
import { lane_plan_wait, type WaitFacts } from './lane-plan-wait'

// joshuafolkken/kit#5986: joshuafolkken/kit#5953 was dispatched first and held committed work when
// `lane:plan` found joshuafolkken/kit#5943, dispatched later, holding a file; the holder's remaining
// time was under the work the yield threw away (the figures are the Issue's).

const OWN = 5953
const HOLDER = 5943
const NOW_MS = Date.parse('2026-11-02T17:56:00Z')
const WORKED_MINUTES = 51
const HOLDER_ELAPSED_MINUTES = 10
const MEDIAN_MINUTES = 33
const CAP_MINUTES = 30
const SHORT_WORK_MINUTES = 5
const EARLIER_MS = Date.parse('2026-11-02T10:00:00Z')
const HOUR_MINUTES = 60
// A holder listing as slow as the one round 2 measured.
const SLOW_READ_MS = 7000

function minutes_ago(minutes: number): number {
	return NOW_MS - minutes * MS_PER_MINUTE
}

function facts(overrides: Partial<WaitFacts> = {}): WaitFacts {
	return {
		own_at_ms: minutes_ago(WORKED_MINUTES),
		holder_at_ms: minutes_ago(HOLDER_ELAPSED_MINUTES),
		has_commits: true,
		median_ms: MEDIAN_MINUTES * MS_PER_MINUTE,
		now_ms: NOW_MS,
		...overrides,
	}
}

function dispatch(issue: number, at_ms: number): LedgerEntry {
	return { kind: 'dispatch', at: new Date(at_ms).toISOString(), issue }
}

function merge(issue: number, at_ms: number): LedgerEntry {
	return { kind: 'merge', at: new Date(at_ms).toISOString(), issue }
}

// A sleeper that moves the faked clock instead of waiting.
async function advance(duration_ms: number): Promise<void> {
	vi.setSystemTime(Date.now() + duration_ms)
}

describe('lane_plan_wait.deadline_of', () => {
	it('waits, capped, in #5953 — dispatched first, committed, holder about 23 minutes from the median', () => {
		expect(lane_plan_wait.deadline_of(facts())).toBe(NOW_MS + CAP_MINUTES * MS_PER_MINUTE)
	})

	it.each([HOLDER_ELAPSED_MINUTES - 1, HOLDER_ELAPSED_MINUTES])(
		'yields to a holder dispatched before it or at once (own %i minutes ago)',
		(own_minutes) => {
			const later = facts({ own_at_ms: minutes_ago(own_minutes) })

			expect(lane_plan_wait.deadline_of(later)).toBeUndefined()
		},
	)

	it('yields when it holds no commits', () => {
		expect(lane_plan_wait.deadline_of(facts({ has_commits: false }))).toBeUndefined()
	})

	it('yields when the holder has more left than the lane has worked', () => {
		const short = facts({ own_at_ms: minutes_ago(SHORT_WORK_MINUTES) })

		expect(lane_plan_wait.deadline_of(short)).toBeUndefined()
	})

	it('bounds the wait by the worked time when that is under the cap', () => {
		const worked = facts({
			median_ms: SHORT_WORK_MINUTES * MS_PER_MINUTE,
			own_at_ms: minutes_ago(SHORT_WORK_MINUTES),
			holder_at_ms: minutes_ago(1),
		})

		expect(lane_plan_wait.deadline_of(worked)).toBe(NOW_MS + SHORT_WORK_MINUTES * MS_PER_MINUTE)
	})
})

describe('lane_plan_wait.facts_from', () => {
	const pair = { issue: OWN, holder: HOLDER }

	it('reads both latest dispatches and the median lane of the recent merges', () => {
		const entries = [
			dispatch(OWN, EARLIER_MS),
			dispatch(OWN, minutes_ago(WORKED_MINUTES)),
			dispatch(HOLDER, minutes_ago(HOLDER_ELAPSED_MINUTES)),
			dispatch(1, minutes_ago(HOUR_MINUTES + MEDIAN_MINUTES)),
			merge(1, minutes_ago(HOUR_MINUTES)),
		]

		expect(lane_plan_wait.facts_from(entries, pair, true, NOW_MS)).toStrictEqual(facts())
	})

	it('answers nothing when the holder was never dispatched', () => {
		const entries = [dispatch(OWN, minutes_ago(WORKED_MINUTES))]

		expect(lane_plan_wait.facts_from(entries, pair, true, NOW_MS)).toBeUndefined()
	})
})

describe('lane_plan_wait.deadline', () => {
	const LEDGER = '/ledger.jsonl'

	beforeEach(() => {
		vi.spyOn(lane_ledger, 'target').mockResolvedValue(LEDGER)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValue([
			dispatch(OWN, minutes_ago(WORKED_MINUTES)),
			dispatch(HOLDER, minutes_ago(HOLDER_ELAPSED_MINUTES)),
			dispatch(1, minutes_ago(HOUR_MINUTES + MEDIAN_MINUTES)),
			merge(1, minutes_ago(HOUR_MINUTES)),
		])
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each([
		[['scripts/lane/one.ts'], NOW_MS + CAP_MINUTES * MS_PER_MINUTE],
		[[], undefined],
	])(
		'reads the ledger and the branch commits %j into the deadline',
		async (committed, expected) => {
			vi.spyOn(lane_plan_signals, 'signals_of').mockResolvedValue({
				hunk_files: [],
				committed_files: committed,
				lines_ratio: undefined,
				implement_rate: undefined,
				split_filed: false,
			})

			expect(await lane_plan_wait.deadline(OWN, HOLDER, NOW_MS)).toBe(expected)
			expect(lane_ledger.read_entries).toHaveBeenCalledWith(LEDGER)
		},
	)
})

describe('lane_plan_wait.hold', () => {
	const ASK_MS = 9 * MS_PER_MINUTE

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'], now: NOW_MS })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('answers `free` once the holder lets go, re-reading once a minute', async () => {
		const is_free = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
		const sleeper = vi.fn(advance)

		expect(await lane_plan_wait.hold(NOW_MS + ASK_MS * 2, is_free, sleeper)).toBe('free')
		expect(sleeper).toHaveBeenCalledWith(MS_PER_MINUTE)
	})

	it('answers `expired` past the deadline without reading the holders', async () => {
		const is_free = vi.fn()

		expect(await lane_plan_wait.hold(NOW_MS - 1, is_free, advance)).toBe('expired')
		expect(is_free).not.toHaveBeenCalled()
	})

	it.each([0, SLOW_READ_MS])(
		'answers `again` within the ask before the deadline, each read taking %i ms',
		async (read_ms) => {
			const is_free = vi.fn(async () => {
				await advance(read_ms)

				return false
			})

			expect(await lane_plan_wait.hold(NOW_MS + ASK_MS * 2, is_free, advance)).toBe('again')
			expect(Date.now() - NOW_MS).toBeLessThanOrEqual(ASK_MS + read_ms)
		},
	)
})
