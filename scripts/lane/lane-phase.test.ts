import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_hold } from '#scripts/run/hold/run-hold'
import { temporary_directory } from '#tools/test/temporary-directory'
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

function push_event(kind: string, text: string): void {
	events.push({ pos: events.length, at: '2026-11-04T00:01:00.000Z', kind, text })
}

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
		push_event('child-launch', `#${ISSUE} dispatched`)
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledTimes(2)
		expect(emit_plan).toHaveBeenCalledTimes(2)
	})
})

// joshuafolkken/kit#8583: a resumed session marks its own first edit, once.
describe('mark_implement — resume scope', () => {
	const source = { [lane_child_marker.KEY]: ISSUE }

	it('writes again after a resume, then not again within that resume', async () => {
		await lane_phase.mark_implement(LANE, source)
		push_event('resume', `#${ISSUE} resumed`)
		await lane_phase.mark_implement(LANE, source)
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledTimes(2)
	})

	it('does not write again after a gate resume', async () => {
		await lane_phase.mark_implement(LANE, source)
		push_event('resume', `#${ISSUE} resumed (gate)`)
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledOnce()
	})

	it('ignores another issue resuming', async () => {
		await lane_phase.mark_implement(LANE, source)
		push_event('resume', '#34440 resumed')
		await lane_phase.mark_implement(LANE, source)
		expect(emit).toHaveBeenCalledOnce()
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

// joshuafolkken/kit#8922: a run in the root checkout carries no lane mark; its live hold names it.
describe('mark_implement — a run holding the root checkout', () => {
	const RUN_ISSUE = '8922'
	const OTHER_PID = 7
	const create_directory = temporary_directory()

	function held_checkout(): string {
		const directory = create_directory('lane-phase-root-')
		const git = path.join(directory, '.git')
		const owner = { owner_pid: process.pid, owner_start: process_identity.read_start(process.pid) }
		const hold = { issue: RUN_ISSUE, taken_at: new Date().toISOString(), pid: OTHER_PID, ...owner }

		mkdirSync(git)
		writeFileSync(run_hold.hold_path(git), JSON.stringify(hold))

		return directory
	}

	it('writes the implement phase for an edit under the hold’s session', async () => {
		await lane_phase.mark_implement(held_checkout(), {}, () => new Set([OTHER_PID, process.pid]))

		expect(emit).toHaveBeenCalledExactlyOnceWith(
			run_event_stream.EVENT_KIND.LANE_PHASE,
			`#${RUN_ISSUE} implement`,
		)
	})

	it('writes nothing for a person’s own session beside the run', async () => {
		await lane_phase.mark_implement(held_checkout(), {}, () => new Set([OTHER_PID]))

		expect(emit).not.toHaveBeenCalled()
		expect(emit_plan).not.toHaveBeenCalled()
	})
})
