import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_phase } from './lane-phase'

// joshuafolkken/kit#3444: the `implement` phase is written for a dispatched lane child only, so a
// person's session or a leaked mark never draws a phase onto a lane the board shows.

const order = vi.hoisted((): Array<string> => [])
const events = vi.hoisted((): Array<RunEvent> => [])

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		invocation_or_all_events: vi.fn(async () => events),
		emit: vi.fn(async (kind: string, text: string): Promise<void> => {
			order.push(kind)
			events.push({ pos: events.length, at: '2026-11-04T00:00:00.000Z', kind, text })
		}),
	},
}))
vi.mock('#scripts/run/event/run-event-plan', () => ({
	run_event_plan: {
		emit_plan: vi.fn(async (): Promise<void> => {
			order.push('plan')
		}),
	},
}))

const { run_event_stream_emit } = await import('#scripts/run/event/run-event-stream-emit')
const { run_event_plan } = await import('#scripts/run/event/run-event-plan')
const emit = vi.mocked(run_event_stream_emit.emit)
const emit_plan = vi.mocked(run_event_plan.emit_plan)

const ISSUE = '3444'
const LANE = `/home/dev/.kit-lanes/${ISSUE}`

afterEach(() => {
	emit.mockClear()
	emit_plan.mockClear()
	order.length = 0
	events.length = 0
})

describe('mark_implement — launch scope', () => {
	it('writes plan and implement once for concurrent runtime edits', async () => {
		const source = { [lane_child_marker.KEY]: ISSUE }

		await Promise.all([
			lane_phase.mark_implement(LANE, source),
			lane_phase.mark_implement(LANE, source),
		])

		expect(emit).toHaveBeenCalledOnce()
		expect(emit_plan).toHaveBeenCalledOnce()
	})

	it('writes once per launch, then writes again for a re-dispatched child', async () => {
		const source = { [lane_child_marker.KEY]: ISSUE }

		await lane_phase.mark_implement(LANE, source)
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledOnce()
		expect(emit_plan).toHaveBeenCalledOnce()
		events.push({
			pos: events.length,
			at: '2026-11-04T00:01:00.000Z',
			kind: 'child-launch',
			text: `#${ISSUE} dispatched`,
		})
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledTimes(2)
		expect(emit_plan).toHaveBeenCalledTimes(2)
	})
})

describe('mark_implement', () => {
	it('writes the implement phase for the lane child of this checkout', async () => {
		await lane_phase.mark_implement(LANE, { [lane_child_marker.KEY]: ISSUE })

		expect(emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.LANE_PHASE,
			`#${ISSUE} implement`,
		)
	})

	it('writes the plan before the implement phase (joshuafolkken/kit#3536)', async () => {
		await lane_phase.mark_implement(LANE, { [lane_child_marker.KEY]: ISSUE })

		expect(emit_plan).toHaveBeenCalledExactlyOnceWith(ISSUE)
		expect(order).toStrictEqual(['plan', run_event_stream.EVENT_KIND.LANE_PHASE])
	})

	it('writes nothing for a person session with no mark', async () => {
		await lane_phase.mark_implement(LANE, {})

		expect(emit).not.toHaveBeenCalled()
		expect(emit_plan).not.toHaveBeenCalled()
	})

	it('writes nothing for a mark leaked from another lane', async () => {
		await lane_phase.mark_implement(LANE, { [lane_child_marker.KEY]: '9999' })

		expect(emit).not.toHaveBeenCalled()
	})

	it('writes nothing in a checkout that is not a lane', async () => {
		await lane_phase.mark_implement('/home/dev/repo', { [lane_child_marker.KEY]: ISSUE })

		expect(emit).not.toHaveBeenCalled()
	})
})
