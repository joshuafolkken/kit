import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_event_stream, type RunEvent } from './run-event-stream'

// joshuafolkken/kit#3536: the `plan` event is written by code once per issue, so `run:entry` and the
// first implementation edit can both ask for it without drawing 📝 twice.

const events_mock = vi.hoisted(() => vi.fn())
const emit_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-event-stream-emit', () => ({
	run_event_stream_emit: { invocation_or_all_events: events_mock, emit: emit_mock },
}))

const { run_event_plan } = await import('./run-event-plan')

const ISSUE = '3536'
const KIND = run_event_stream.EVENT_KIND

function event(kind: string, text: string): RunEvent {
	return { pos: 1, at: '2026-10-09T00:00:00.000Z', kind, text }
}

beforeEach(() => {
	events_mock.mockReset().mockResolvedValue([])
	emit_mock.mockReset().mockResolvedValue(undefined)
})

describe('run_event_plan.emit_plan', () => {
	it('appends the plan event for an issue the invocation has not planned', async () => {
		events_mock.mockResolvedValue([event(KIND.LANE_PHASE, `#${ISSUE} implement`)])

		await run_event_plan.emit_plan(ISSUE)

		expect(emit_mock).toHaveBeenCalledExactlyOnceWith(KIND.PLAN, `planned #${ISSUE}`)
	})

	it('appends nothing when the issue already has a plan event', async () => {
		events_mock.mockResolvedValue([event(KIND.PLAN, run_event_plan.plan_text(ISSUE))])

		await run_event_plan.emit_plan(ISSUE)

		expect(emit_mock).not.toHaveBeenCalled()
	})

	it('appends again for a child re-dispatched after its plan event', async () => {
		events_mock.mockResolvedValue([
			event(KIND.CHILD_LAUNCH, `#${ISSUE} dispatched`),
			event(KIND.PLAN, run_event_plan.plan_text(ISSUE)),
			event(KIND.CHILD_LAUNCH, `#${ISSUE} dispatched`),
		])

		await run_event_plan.emit_plan(ISSUE)

		expect(emit_mock).toHaveBeenCalledExactlyOnceWith(KIND.PLAN, `planned #${ISSUE}`)
	})

	it('ignores another issue plan event', async () => {
		events_mock.mockResolvedValue([event(KIND.PLAN, run_event_plan.plan_text('9999'))])

		await run_event_plan.emit_plan(ISSUE)

		expect(emit_mock).toHaveBeenCalledExactlyOnceWith(KIND.PLAN, `planned #${ISSUE}`)
	})
})
