import { process_identity } from '#scripts/josh/process-identity'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_found, type IsLive } from './run-board-found'

// joshuafolkken/kit#4772, joshuafolkken/kit#4818: a done row's end is read off the stream — the filings
// found during its child, its lane's net minutes and its latest overrun note, an investigation running
// while its end note is not on the stream yet and its session is alive.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-24T09:00:00.000Z'
const CHILD = 4711
const PID = 3616
const START = 'proc:9876'
const MINUTES = 55
const WITHIN_MINUTES = 18
const NO_DISPATCH = 'no dispatch'
const ELSEWHERE = 'joshuafolkken/app-kit#12'

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

function filing(reference: string, found_during: string | undefined, is_overrun = false): RunEvent {
	const text = run_event_filed.text_of({
		reference,
		kind: 'bug',
		title: 'Shorten the wait',
		found_during,
		is_run: true,
		is_overrun,
	})

	return event(KIND.FILED, text)
}

function filed(reference: string): RunEvent {
	return filing(reference, String(CHILD))
}

function overrun_filed(reference: string): RunEvent {
	return filing(reference, String(CHILD), true)
}

function started(issue = CHILD): RunEvent {
	const outcome = run_event_overrun.investigating(PID, START)

	return event(KIND.NOTE, run_event_overrun.started_text(issue, MINUTES, outcome))
}

function alive(): boolean {
	return true
}

function dead(): boolean {
	return false
}

describe('run_board_found.found_of — the filings', () => {
	it('gathers the filings found during a child, in the stream’s order, with no `#`', () => {
		const events = [filed('#4768'), filed('#4769'), filed('#4770')]

		expect(run_board_found.found_of(events, alive).get(CHILD)).toStrictEqual({
			filed: ['4768', '4769', '4770'],
			overrun_filed: [],
			minutes: undefined,
			overrun: undefined,
			longest: undefined,
			is_investigating: false,
		})
	})

	it('keeps a filing in another repository as its reference', () => {
		const found = run_board_found.found_of([filed(ELSEWHERE)], alive)

		expect(found.get(CHILD)?.filed).toStrictEqual([ELSEWHERE])
	})

	it('reads a filing found during no child as nobody’s', () => {
		expect(run_board_found.found_of([filing('#4768', undefined)], alive).size).toBe(0)
	})

	// joshuafolkken/kit#4880: the overrun investigation's filings are kept apart from the child's own.
	it('keeps the overrun investigation’s filings apart from the child’s own', () => {
		const events = [filed('#4847'), overrun_filed('#4856'), filed('#4848')]
		const found = run_board_found.found_of(events, alive).get(CHILD)

		expect(found?.filed).toStrictEqual(['4847', '4848'])
		expect(found?.overrun_filed).toStrictEqual(['4856'])
	})

	it('reads a filing written before the overrun mark as the child’s', () => {
		const text = `#4847[bug][run] Shorten the wait (found during #${String(CHILD)})`
		const found = run_board_found.found_of([event(KIND.FILED, text)], alive).get(CHILD)

		expect(found?.filed).toStrictEqual(['4847'])
		expect(found?.overrun_filed).toStrictEqual([])
	})
})

describe('run_board_found.found_of — the investigation', () => {
	it('reads an investigation with no end note and a live session as running', () => {
		const found = run_board_found.found_of([filed('#4768'), started()], alive).get(CHILD)

		expect(found?.filed).toStrictEqual(['4768'])
		expect(found?.is_investigating).toBe(true)
		expect(found?.minutes).toBe(MINUTES)
	})

	it('reads one whose session ended as finished, its minutes kept', () => {
		const ended = event(KIND.NOTE, run_event_overrun.ended_text(CHILD, 'filed'))
		const found = run_board_found.found_of([started(), ended], alive).get(CHILD)

		expect(found?.is_investigating).toBe(false)
		expect(found?.overrun).toStrictEqual({ kind: 'ended', issue: CHILD, result: 'filed' })
		expect(found?.minutes).toBe(MINUTES)
	})

	it('reads one whose launch failed as finished', () => {
		const failed = event(KIND.NOTE, run_event_overrun.failed_text(CHILD, 'no profile'))
		const found = run_board_found.found_of([started(), failed], alive).get(CHILD)

		expect(found?.is_investigating).toBe(false)
		expect(found?.overrun?.kind).toBe('failed')
	})

	it('reads one whose session died before its end note as not running', () => {
		expect(run_board_found.found_of([started()], dead).get(CHILD)?.is_investigating).toBe(false)
	})

	it('hands the probe the start note’s pid and start time', () => {
		const probe = vi.fn<IsLive>(alive)

		run_board_found.found_of([started()], probe)

		expect(probe).toHaveBeenCalledWith(PID, START)
	})

	it('ends only the investigation its end note names', () => {
		const other = event(KIND.NOTE, run_event_overrun.ended_text(CHILD + 1, 'none: CI wait'))
		const found = run_board_found.found_of([started(), other], alive)

		expect(found.get(CHILD)?.is_investigating).toBe(true)
	})
})

// joshuafolkken/kit#4995: the longest stage rides the start note, and the end note does not drop it.
describe('run_board_found.found_of — the longest stage', () => {
	const longest = { name: 'implement', minutes: 51 }

	function started_with_longest(): RunEvent {
		const outcome = run_event_overrun.investigating(PID, START)

		return event(KIND.NOTE, run_event_overrun.started_text(CHILD, MINUTES, outcome, longest))
	}

	it('keeps the longest stage past the end note', () => {
		const ended = event(KIND.NOTE, run_event_overrun.ended_text(CHILD, 'filed'))
		const found = run_board_found.found_of([started_with_longest(), ended], alive).get(CHILD)

		expect(found?.longest).toStrictEqual(longest)
	})

	it('has none for a start note written without it', () => {
		expect(run_board_found.found_of([started()], alive).get(CHILD)?.longest).toBeUndefined()
	})
})

describe('run_board_found.found_of — the net minutes', () => {
	it('reads the minutes of a lane at or under the threshold', () => {
		const within = event(KIND.NOTE, run_event_overrun.within_text(CHILD, WITHIN_MINUTES))

		expect(run_board_found.found_of([within], alive).get(CHILD)?.minutes).toBe(WITHIN_MINUTES)
	})

	it('reads a skipped lane as having no minutes', () => {
		const skipped = event(KIND.NOTE, run_event_overrun.skipped_text(CHILD, NO_DISPATCH))
		const found = run_board_found.found_of([skipped], alive).get(CHILD)

		expect(found?.minutes).toBeUndefined()
		expect(found?.overrun).toStrictEqual({ kind: 'skipped', issue: CHILD, reason: NO_DISPATCH })
	})
})

// This process's own row, as the read's `ps` snapshot carries it.
function own_table(): TableRead {
	const row = { pid: process.pid, parent: 1, time: '0:01', rss_kb: 1, stat: 'S', command: 'node' }
	const start = process_identity.own_start() ?? ''

	return vi.fn<TableRead>(async () => [{ ...row, start }])
}

describe('run_board_found.live_in — the board’s probe', () => {
	it('reads the session it names as live', async () => {
		const start = process_identity.own_start()
		const is_live = await run_board_found.live_in(own_table())

		expect(is_live(process.pid, start)).toBe(start !== undefined)
	})

	it('reads a later process given the session’s pid as not the session', async () => {
		const is_live = await run_board_found.live_in(own_table())

		expect(is_live(process.pid, 'proc:0')).toBe(false)
	})

	it('reads a note with no start time on a live pid as unknown, since its pid alone names no process', async () => {
		const is_live = await run_board_found.live_in(own_table())

		expect(is_live(process.pid, undefined)).toBeUndefined()
	})

	it('asks the snapshot once however many notes it probes', async () => {
		const table = own_table()
		const is_live = await run_board_found.live_in(table)

		run_board_found.found_of([started(), started(CHILD + 1)], is_live)

		expect(table).toHaveBeenCalledOnce()
	})

	it('reads no session live where the snapshot could not be taken', async () => {
		const is_live = await run_board_found.live_in(undefined)

		expect(is_live(PID, START)).toBe(false)
	})
})
