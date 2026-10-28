import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold_member } from '#scripts/run/hold/run-hold-member'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'

// joshuafolkken/kit#4750: `josh issue:file` caps automatic filings at ten per originating work item,
// counted from the origin's run-marked `filed` events on the run's event stream — stubbed here at the
// namespaces the fold reads them through.

const AT = '2026-10-24T00:00:00.000Z'
const ORIGIN = '4750'
const OTHER = '4751'
const FIRST_NUMBER = 5000
const BELOW_CAP = issue_file_cap.FILING_CAP - 1

function filed(number: number, found_during?: string, marker = '[][run]'): RunEvent {
	const during = found_during === undefined ? '' : ` (found during #${found_during})`

	return {
		pos: 0,
		at: AT,
		kind: run_event_stream.EVENT_KIND.FILED,
		text: `#${String(number)}${marker} Something found${during}`,
	}
}

function filings(count: number, found_during?: string, marker?: string): ReadonlyArray<RunEvent> {
	return Array.from({ length: count }, (_unused, index) =>
		filed(FIRST_NUMBER + index, found_during, marker),
	)
}

const all_events = vi.spyOn(run_event_stream_emit, 'all_events')
const current_events = vi.spyOn(run_event_stream_emit, 'current_events')
const branch = vi.spyOn(git_command, 'branch')
const is_run_member = vi.spyOn(run_hold_member, 'is_run_member')
const error = vi.spyOn(console, 'error')

beforeEach(() => {
	error.mockImplementation(() => undefined)
	vi.stubEnv(lane_child_marker.KEY, ORIGIN)
	all_events.mockResolvedValue([])
	current_events.mockResolvedValue([])
	branch.mockResolvedValue('main')
	is_run_member.mockResolvedValue(true)
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('issue_file_cap.is_cap_clear — ten filings per originating work item', () => {
	it('lets origins each under the cap file more than ten between them', async () => {
		all_events.mockResolvedValue([...filings(BELOW_CAP, ORIGIN), ...filings(BELOW_CAP, OTHER)])

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(true)
		expect(await issue_file_cap.is_cap_clear(OTHER)).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})

	it('refuses the eleventh filing from one origin, counted off the whole stream', async () => {
		all_events.mockResolvedValue(filings(issue_file_cap.FILING_CAP, ORIGIN))

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(false)
		expect(current_events).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledExactlyOnceWith(issue_file_cap.reason_of(ORIGIN))
	})

	it('counts only filed events, so a failed filing that emitted none does not count', async () => {
		const note: RunEvent = { pos: 0, at: AT, kind: run_event_stream.EVENT_KIND.NOTE, text: '#1 x' }

		all_events.mockResolvedValue([...filings(BELOW_CAP, ORIGIN), note])

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(true)
	})
})

describe('issue_file_cap.is_cap_clear — only a run’s filings are automatic', () => {
	it('lets a person’s own session file past the cap', async () => {
		is_run_member.mockResolvedValue(false)
		all_events.mockResolvedValue(filings(issue_file_cap.FILING_CAP, ORIGIN))

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(true)
		expect(all_events).not.toHaveBeenCalled()
	})

	it('does not count the filings a person’s session made', async () => {
		all_events.mockResolvedValue(filings(issue_file_cap.FILING_CAP, ORIGIN, '[]'))

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(true)
	})
})

describe('issue_file_cap.is_cap_clear — a filing with no origin', () => {
	beforeEach(() => {
		vi.stubEnv(lane_child_marker.KEY, undefined)
	})

	it('counts against the carry-scoped invocation', async () => {
		current_events.mockResolvedValue(filings(issue_file_cap.FILING_CAP))

		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(false)
		expect(all_events).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledExactlyOnceWith(issue_file_cap.reason_of(undefined))
	})

	it('counts nothing outside a run', async () => {
		expect(await issue_file_cap.is_cap_clear(undefined)).toBe(true)
	})
})
