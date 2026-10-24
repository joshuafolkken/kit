import { process_identity } from '#scripts/josh/process-identity'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_overrun } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it, vi } from 'vitest'
import { run_board_found, type IsLive } from './run-board-found'

// joshuafolkken/kit#4772: a done row's end is read off the stream — the filings found during its child,
// and an overrun investigation whose end note is not on the stream yet and whose session is alive.

const KIND = run_event_stream.EVENT_KIND
const AT = '2026-10-24T09:00:00.000Z'
const CHILD = 4711
const PID = 3616
const START = 'proc:9876'
const MINUTES = 55
const ELSEWHERE = 'joshuafolkken/app-kit#12'

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: AT, kind, text }
}

function filing(reference: string, found_during: string | undefined): RunEvent {
	const text = run_event_filed.text_of({
		reference,
		kind: 'bug',
		title: 'Shorten the wait',
		found_during,
		is_run: true,
	})

	return event(KIND.FILED, text)
}

function filed(reference: string): RunEvent {
	return filing(reference, String(CHILD))
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
})

describe('run_board_found.found_of — the investigation', () => {
	it('reads an investigation with no end note and a live session as running', () => {
		const found = run_board_found.found_of([filed('#4768'), started()], alive)

		expect(found.get(CHILD)).toStrictEqual({ filed: ['4768'], is_investigating: true })
	})

	it('reads one whose session ended as finished', () => {
		const ended = event(KIND.NOTE, run_event_overrun.ended_text(CHILD, 'filed #4768'))

		expect(run_board_found.found_of([started(), ended], alive).get(CHILD)).toBeUndefined()
	})

	it('reads one whose launch failed as finished', () => {
		const failed = event(KIND.NOTE, run_event_overrun.failed_text(CHILD, 'no profile'))

		expect(run_board_found.found_of([started(), failed], alive).get(CHILD)).toBeUndefined()
	})

	it('reads one whose session died before its end note as finished', () => {
		expect(run_board_found.found_of([started()], dead).get(CHILD)).toBeUndefined()
	})

	it('hands the probe the start note’s pid and start time', () => {
		const probe = vi.fn<IsLive>(alive)

		run_board_found.found_of([started()], probe)

		expect(probe).toHaveBeenCalledWith(PID, START)
	})

	it('ends only the investigation its end note names', () => {
		const other = event(KIND.NOTE, run_event_overrun.ended_text(CHILD + 1, 'none filed'))
		const found = run_board_found.found_of([started(), other], alive)

		expect(found.get(CHILD)?.is_investigating).toBe(true)
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

	it('reads a note with no start time as no session, since its pid alone names no process', async () => {
		const is_live = await run_board_found.live_in(own_table())

		expect(is_live(process.pid, undefined)).toBe(false)
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
