import { MS_PER_MINUTE, MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_dispatch_wait_stats } from './lane-dispatch-wait-stats'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#7508: each dispatch's wait from the moment its issue became runnable, with the
// time no seat was there taken out, reduced to the period's median, longest and count over one minute.

const NOW = Date.parse('2026-11-14T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const ISSUE = 7503
const ROW_LABEL = 'runnable → dispatch'
const NOT_MEASURED = 'not measured'

function minutes_before_now(minutes: number): string {
	return new Date(NOW - minutes * MS_PER_MINUTE).toISOString()
}

function offer(
	minutes_before: number,
	seen: Array<number>,
	excluded: Array<number> = [],
): LedgerEntry {
	return {
		kind: 'offer',
		at: minutes_before_now(minutes_before),
		verdict: seen.length === 0 ? 'none' : 'run',
		seen,
		started: seen.filter((issue) => !excluded.includes(issue)),
		excluded: excluded.map((issue) => ({ issue, reason: 'triage' })),
		is_unchanged: false,
	}
}

function held(reason: string, minutes_before: number): LedgerEntry {
	return { kind: 'held', at: minutes_before_now(minutes_before), reason }
}

function dispatch(minutes_before: number, issue = ISSUE): LedgerEntry {
	return { kind: 'dispatch', at: minutes_before_now(minutes_before), issue }
}

function filed(minutes_before: number, reference = `#${String(ISSUE)}`): RunEvent {
	return {
		pos: 0,
		at: minutes_before_now(minutes_before),
		kind: 'filed',
		text: `${reference}[] Report runnable-to-dispatch latency`,
	}
}

function cells_of(
	entries: ReadonlyArray<LedgerEntry>,
	events: ReadonlyArray<RunEvent> = [],
): Array<string> {
	const row = lane_dispatch_wait_stats
		.table(entries, WINDOW, events)
		.split('\n')
		.find((line) => line.startsWith(`| ${ROW_LABEL} |`))

	return (row ?? '')
		.split('|')
		.slice(2, -1)
		.map((cell) => cell.trim())
}

// #7503's sequence: an exhausted offer, the filing, the drained driver's hand-back, the next run offer
// and the dispatch, as far after the filing as #7503's was.
const DISPATCH_AFTER_FILED_MINUTES = 5 + 27 * (MS_PER_SECOND / MS_PER_MINUTE)
const FILED_MINUTES_BEFORE = 20
const ISSUE_7503_ENTRIES: Array<LedgerEntry> = [
	offer(25, []),
	held('hand-back:drained', 18),
	offer(15, [ISSUE]),
	dispatch(FILED_MINUTES_BEFORE - DISPATCH_AFTER_FILED_MINUTES),
]

describe('lane_dispatch_wait_stats.table — the runnable start', () => {
	it('measures #7503 from its filing to its dispatch, past the one-minute bound', () => {
		const [dispatches, , max, longest, over, unmeasured] = cells_of(ISSUE_7503_ENTRIES, [
			filed(FILED_MINUTES_BEFORE),
		])

		expect([dispatches, longest, over, unmeasured]).toStrictEqual(['1', '#7503', '1', '0'])
		expect(max).toMatch(/^5\.\d$/u)
	})

	it('starts at the first runnable offer when no filing precedes it', () => {
		expect(cells_of(ISSUE_7503_ENTRIES)[2]).toBe('0.5')
	})

	it('ignores a filing in another repository', () => {
		const events = [filed(FILED_MINUTES_BEFORE, 'joshuafolkken/other#7503')]

		expect(cells_of(ISSUE_7503_ENTRIES, events)[2]).toBe('0.5')
	})

	it('restarts the wait after an offer that held the issue back', () => {
		const entries = [
			offer(30, [ISSUE]),
			offer(10, [ISSUE], [ISSUE]),
			offer(6, [ISSUE]),
			dispatch(2),
		]

		expect(cells_of(entries, [filed(40)])[2]).toBe('4.0')
	})
})

describe('lane_dispatch_wait_stats.table — seats that were not there', () => {
	it.each(['memory', 'usage-limit', 'offer:watch:solo'])('takes out a %s hold', (reason) => {
		const entries = [
			offer(30, [ISSUE]),
			held(reason, 29),
			held('offer:watch:chain', 9),
			dispatch(8),
		]
		const cells = cells_of(entries)

		expect([cells[2], cells[4]]).toStrictEqual(['2.0', '1'])
	})

	it('takes out the time after a release until the next driver line', () => {
		const released: LedgerEntry = { kind: 'released', at: minutes_before_now(29) }
		const entries = [offer(30, [ISSUE]), released, held('hand-back:merge', 9.5), dispatch(9)]

		expect(cells_of(entries)[2]).toBe('1.5')
	})

	it('keeps a hold a free seat waited through', () => {
		const entries = [offer(30, [ISSUE]), held('offer:wait:blocked', 29), dispatch(8)]

		expect(cells_of(entries)[2]).toBe('22.0')
	})
})

describe('lane_dispatch_wait_stats.table — records without an offer', () => {
	it('counts a dispatch no offer saw as not measured', () => {
		const unread = [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]

		expect(cells_of([held('memory', 30), dispatch(8)])).toStrictEqual(['1', ...unread, '0', '1'])
	})

	it('prints the row for a period with no dispatch', () => {
		const unread = [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]

		expect(cells_of([])).toStrictEqual(['0', ...unread, '0', '0'])
	})

	it('measures a re-dispatch from the offers after the previous one, not its first filing', () => {
		const entries = [offer(30, [ISSUE]), dispatch(29), offer(5, [ISSUE]), dispatch(3)]

		expect(cells_of(entries, [filed(40)]).slice(0, 4)).toStrictEqual(['2', '6.5', '11.0', '#7503'])
	})

	it('reads nothing from a retry offer, which excludes only the issues asked to', () => {
		const retry: LedgerEntry = {
			kind: 'offer',
			at: minutes_before_now(20),
			verdict: 'retry',
			seen: [ISSUE],
			started: [],
			excluded: [],
			is_unchanged: false,
		}
		const entries = [offer(30, [ISSUE], [ISSUE]), retry, offer(6, [ISSUE]), dispatch(2)]

		expect(cells_of(entries)[2]).toBe('4.0')
	})
})
