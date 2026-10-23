import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const events_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())
const add_label_mock = vi.hoisted(() => vi.fn())
const comment_mock = vi.hoisted(() => vi.fn())
const warn_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { all_events: events_mock, emit: emit_mock },
}))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_add_label: add_label_mock, issue_try_comment: comment_mock },
}))
vi.mock('#scripts/notify/telegram-notify', () => ({ telegram_notify: { warn: warn_mock } }))

const { run_ship_relaunch_cap } = await import('./run-ship-relaunch-cap')

// joshuafolkken/kit#3999: a stopped ship relaunches its lane child only so many times since the issue's
// dispatch; past that the issue is parked and a person told.

const ISSUE = '3999'
const OTHER = '4001'
const { MAX_SHIP_STOP_RELAUNCHES } = run_ship_relaunch_cap

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-10-17T00:00:00.000Z', kind, text }
}

function dispatched(issue: string): RunEvent {
	return event('child-launch', `#${issue} dispatched`)
}

function stops(issue: string, count: number): Array<RunEvent> {
	return Array.from({ length: count }, () =>
		event('ship-stop', `#${issue} gate failed (check) — pnpm josh ship --log ${issue}`),
	)
}

beforeEach(() => {
	events_mock.mockReset().mockResolvedValue([])
	emit_mock.mockReset()
	add_label_mock.mockReset().mockResolvedValue(true)
	comment_mock.mockReset().mockResolvedValue(true)
	warn_mock.mockReset().mockResolvedValue(true)
})

describe('run_ship_relaunch_cap.stops_since_dispatch', () => {
	it("counts only the issue's own ship stops", () => {
		const events = [...stops(ISSUE, 2), ...stops(OTHER, 3)]

		expect(run_ship_relaunch_cap.stops_since_dispatch(events, ISSUE)).toBe(2)
	})

	it('starts a new count at the latest dispatch of the issue', () => {
		const events = [...stops(ISSUE, 3), dispatched(ISSUE), ...stops(ISSUE, 1)]

		expect(run_ship_relaunch_cap.stops_since_dispatch(events, ISSUE)).toBe(1)
	})

	it("is not reset by another issue's dispatch", () => {
		const events = [...stops(ISSUE, 2), dispatched(OTHER), ...stops(ISSUE, 1)]

		expect(run_ship_relaunch_cap.stops_since_dispatch(events, ISSUE)).toBe(3)
	})
})

describe('run_ship_relaunch_cap.is_over', () => {
	it('relaunches up to the cap', async () => {
		events_mock.mockResolvedValue([dispatched(ISSUE), ...stops(ISSUE, MAX_SHIP_STOP_RELAUNCHES)])

		expect(await run_ship_relaunch_cap.is_over(ISSUE)).toBe(false)
	})

	it('is over once the stops since the dispatch pass the cap', async () => {
		const over = MAX_SHIP_STOP_RELAUNCHES + 1

		events_mock.mockResolvedValue([dispatched(ISSUE), ...stops(ISSUE, over)])

		expect(await run_ship_relaunch_cap.is_over(ISSUE)).toBe(true)
	})
})

describe('run_ship_relaunch_cap.park', () => {
	it('labels, comments, records the park and warns', async () => {
		expect(await run_ship_relaunch_cap.park(ISSUE, 'round-2')).toBe(true)

		expect(add_label_mock).toHaveBeenCalledWith(ISSUE, 'run:stalled')
		expect(String(comment_mock.mock.calls[0]?.[1])).toContain(`pnpm josh ship --log ${ISSUE}`)
		expect(emit_mock).toHaveBeenCalledWith('park', `#${ISSUE} parked (run:stalled: ship-stop cap)`)
		expect(warn_mock).toHaveBeenCalledWith(
			expect.objectContaining({ body: expect.stringContaining('round-2') as unknown }),
		)
	})

	it('reports no park and tells nobody when the label was refused', async () => {
		add_label_mock.mockResolvedValue(false)

		expect(await run_ship_relaunch_cap.park(ISSUE, 'gate')).toBe(false)
		expect(emit_mock).not.toHaveBeenCalled()
		expect(warn_mock).not.toHaveBeenCalled()
	})
})
