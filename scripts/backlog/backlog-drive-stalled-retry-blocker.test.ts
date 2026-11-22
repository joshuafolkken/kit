import type { EpicIssue } from '#scripts/epic/epic-issue'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { josh_command } from '#scripts/josh/josh-run'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'

// joshuafolkken/kit#7861: #7841 stayed `run:stalled` after the blocker its triage recorded merged —
// a drive other than the one that merged it never re-offered the park.

const STALLED = 7841
const BLOCKER = 7839
const OTHER_BLOCKER = 7840
const PARKED_AT = '2026-11-17T17:25:36Z'
const BEFORE_PARK = '2026-11-17T09:00:00Z'
const CLOSED_AFTER_PARK = '2026-11-18T03:23:12Z'
const AFTER_CLOSE = '2026-11-18T04:00:00Z'
// #7841's park: a `run:merge` followup stop, recorded with no stop.
const PARK_TEXT = `#${String(STALLED)} parked (${RUN_STALLED_LABEL}: followup failed)`
const RETRY_ARGV = ['run:add', String(STALLED), '--retry']
const { ADD, PARK } = run_event_stream.EVENT_KIND

type Blocker = NonNullable<EpicIssue['blockedBy']>['nodes'][number]

function stalled_park(text = PARK_TEXT, at = PARKED_AT): RunEvent {
	return { pos: 1, kind: PARK, text, at }
}

function blocker(state = 'CLOSED', closed_at = CLOSED_AFTER_PARK, number = BLOCKER): Blocker {
	return { number, state, closed_at: state === 'CLOSED' ? closed_at : undefined }
}

function triaged(nodes: ReadonlyArray<Blocker>): EpicIssue {
	return {
		number: STALLED,
		title: '',
		body: '',
		state: 'OPEN',
		url: '',
		labels: [{ name: RUN_STALLED_LABEL }],
		blockedBy: { nodes: [...nodes], totalCount: nodes.length },
	}
}

function given(nodes: ReadonlyArray<Blocker>, park = stalled_park(), history = [park]): void {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([park])
	vi.mocked(run_event_stream_emit.all_events).mockResolvedValue(history)
	vi.mocked(run_add_issue.read).mockResolvedValue(triaged(nodes))
}

const clock = { now: 0 }

async function next_sweep(): Promise<void> {
	clock.now += backlog_budget.OFFER_INTERVAL_MS
	await backlog_drive_stalled_retry.sweep(clock.now)
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'current_events')
	vi.spyOn(run_event_stream_emit, 'all_events')
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_add_issue, 'read')
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'queued' })
})

afterEach(() => vi.restoreAllMocks())

describe('backlog_drive_stalled_retry.sweep — a blocker triage recorded on the park', () => {
	it('retries once the recorded blocker closed, whichever drive merged it (ac-430e3c48, ac-d6c462db)', async () => {
		given([blocker(), blocker('CLOSED', BEFORE_PARK, OTHER_BLOCKER)])
		await next_sweep()

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, {
			should_forward_stderr: true,
		})
	})

	it('retries a park restated at the cap once its blocker closed (ac-430e3c48)', async () => {
		const retry: RunEvent = { pos: 0, kind: ADD, text: run_event_retry.text_of(STALLED), at: '' }
		const capped = stalled_park(`${PARK_TEXT} ${backlog_drive_stalled_retry.CAP_NOTE}`)

		given([blocker()], capped, [retry, retry, capped])
		await next_sweep()

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, {
			should_forward_stderr: true,
		})
	})
})

describe('backlog_drive_stalled_retry.sweep — a blocked park left as it is', () => {
	it.each([
		['the recorded blocker still open', [blocker('OPEN')]],
		['another blocker still open', [blocker(), blocker('OPEN', '', OTHER_BLOCKER)]],
		['only a blocker closed before the park', [blocker('CLOSED', BEFORE_PARK)]],
		['no blocker recorded', []],
	])('does not retry with %s (ac-e9e53a64)', async (_case, nodes) => {
		given(nodes)
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})

	it("does not retry the retry's own park a second time for the same close (ac-430e3c48)", async () => {
		given([blocker()], stalled_park(PARK_TEXT, AFTER_CLOSE))
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})

	it('restates a park whose retry run:add refuses, so the next sweep does not ask again', async () => {
		vi.mocked(josh_command.josh_run).mockResolvedValue({ code: 1, out: 'refused' })
		vi.spyOn(console, 'error').mockReturnValue()
		given([blocker()])
		await next_sweep()

		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(PARK, PARK_TEXT, {})
	})
})
