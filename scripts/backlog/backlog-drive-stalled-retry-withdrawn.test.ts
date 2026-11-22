import type { EpicIssue } from '#scripts/epic/epic-issue'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { josh_command } from '#scripts/josh/josh-run'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'

// joshuafolkken/kit#8599: `run:add --retry` now re-admits a withdrawn issue, so the drive's own stalled
// sweep must not run it on a park a person withdrew — putting it back stays theirs.

const PARKED = 6675
const AT = '2026-11-09T10:01:00Z'
const { PARK, WITHDRAW } = run_event_stream.EVENT_KIND

const PARK_EVENT: RunEvent = {
	pos: 1,
	kind: PARK,
	text: run_stalled.park_event(PARKED, run_stalled.SESSION_UNFINISHED.short),
	at: AT,
}

const WITHDRAW_EVENT: RunEvent = {
	pos: 2,
	kind: WITHDRAW,
	text: `#${String(PARKED)} withdrawn by a person`,
	at: AT,
}

const STALLED: EpicIssue = {
	number: PARKED,
	title: '',
	body: '',
	state: 'OPEN',
	url: '',
	labels: [{ name: RUN_STALLED_LABEL }],
	blockedBy: undefined,
}

const clock = { now: 0 }

async function sweep_over(events: ReadonlyArray<RunEvent>): Promise<void> {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue(events)
	vi.mocked(run_event_stream_emit.all_events).mockResolvedValue(events)
	clock.now += backlog_budget.OFFER_INTERVAL_MS
	await backlog_drive_stalled_retry.sweep(clock.now)
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'current_events')
	vi.spyOn(run_event_stream_emit, 'all_events')
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_add_issue, 'read').mockResolvedValue(STALLED)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'queued' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_drive_stalled_retry.sweep — a park a person withdrew', () => {
	it('re-offers a cleared park nobody withdrew', async () => {
		await sweep_over([PARK_EVENT])

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(
			['run:add', String(PARKED), '--retry'],
			{ should_forward_stderr: true },
		)
	})

	it('leaves a withdrawn park for the person to put back', async () => {
		await sweep_over([PARK_EVENT, WITHDRAW_EVENT])

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})
})
