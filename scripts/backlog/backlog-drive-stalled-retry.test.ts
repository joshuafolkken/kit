import type { EpicIssue } from '#scripts/epic/epic-issue'
import { git_gh_pr_snapshot } from '#scripts/gh/git-gh-pr-snapshot'
import { REQUIRED_CHECKS } from '#scripts/gh/git-pr-checks-eval'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { josh_command } from '#scripts/josh/josh-run'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_board_ending_reason } from '#scripts/run/board/run-board-ending-reason'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_event_retry } from '#scripts/run/event/run-event-retry'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'

const PARKED = 6675
const AT = '2026-11-09T10:01:00Z'
const REQUIRED_CONTEXT = 'Checks'
const FOLLOWUP_STOP = { stage: 'followup', cause: 'check' }
const RETRY_ARGV = ['run:add', String(PARKED), '--retry']
const FOLLOWUP: Pick<RunEvent, 'stop'> = { stop: FOLLOWUP_STOP }
const { ADD, PARK } = run_event_stream.EVENT_KIND
const CARRY = run_carry.fresh_carry('backlogrun', run_carry.owner_of(process.pid), new Date(AT))

// `{}` stands for a park written before it carried a stop.
function park(stop = FOLLOWUP, cause = 'ship-stop cap'): RunEvent {
	return {
		pos: 1,
		kind: PARK,
		text: `#${String(PARKED)} parked (${RUN_STALLED_LABEL}: ${cause})`,
		at: AT,
		...stop,
	}
}

function retry_event(pos: number): RunEvent {
	return { pos, kind: ADD, text: run_event_retry.text_of(PARKED), at: AT }
}

function issue(labels: ReadonlyArray<string> = [RUN_STALLED_LABEL], state = 'OPEN'): EpicIssue {
	return {
		number: PARKED,
		title: '',
		body: '',
		state,
		url: '',
		labels: labels.map((name) => ({ name })),
		blockedBy: undefined,
	}
}

function check_run(name: string, conclusion = 'SUCCESS'): Record<string, string> {
	return { __typename: 'CheckRun', name, status: 'COMPLETED', conclusion }
}

function mock_checks(rollup: ReadonlyArray<Record<string, string>>, merge_state = 'CLEAN'): void {
	const snapshot_json = JSON.stringify({
		statusCheckRollup: rollup,
		requiredContexts: [REQUIRED_CONTEXT],
		mergeStateStatus: merge_state,
	})

	vi.mocked(git_gh_pr_snapshot.pr_get_checks_snapshot).mockResolvedValue({
		pr_number: 1,
		snapshot_json,
	})
}

const GREEN = [...REQUIRED_CHECKS, REQUIRED_CONTEXT].map((name) => check_run(name))

function mock_stream(events: ReadonlyArray<RunEvent>, history = events): void {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue(events)
	vi.mocked(run_event_stream_emit.all_events).mockResolvedValue(history)
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'current_events')
	vi.spyOn(run_event_stream_emit, 'all_events')
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_add_issue, 'read').mockResolvedValue(issue())
	vi.spyOn(git_gh_pr_snapshot, 'pr_get_checks_snapshot')
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'queued' })
	mock_stream([park()])
	mock_checks(GREEN)
})

afterEach(() => vi.restoreAllMocks())

const clock = { now: 0 }

// Each sweep lands one offer interval after the last, past the throttle.
async function next_sweep(): Promise<void> {
	clock.now += backlog_budget.OFFER_INTERVAL_MS
	await backlog_drive_stalled_retry.sweep(clock.now)
}

describe('backlog_drive_stalled_retry.sweep — the cause cleared', () => {
	it('retries a mechanical followup park through run:add --retry (ac-765f9d97)', async () => {
		await next_sweep()

		expect(git_gh_pr_snapshot.pr_get_checks_snapshot).toHaveBeenCalledWith(`${String(PARKED)}-lane`)
		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, true)
	})

	it('retries below the cap, counting earlier retries (ac-765f9d97)', async () => {
		mock_stream([park()], [retry_event(0), park()])
		await next_sweep()

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, true)
	})

	it('leaves a park run:add refuses for a person, without ending the drive', async () => {
		vi.mocked(josh_command.josh_run).mockResolvedValue({ code: 1, out: 'refused' })
		vi.spyOn(console, 'error').mockReturnValue()

		await expect(next_sweep()).resolves.toBeUndefined()
		expect(console.error).toHaveBeenCalledOnce()
	})

	it('sweeps at most once per offer interval', async () => {
		await next_sweep()
		await backlog_drive_stalled_retry.sweep(clock.now + 1)

		expect(josh_command.josh_run).toHaveBeenCalledOnce()
	})
})

describe('backlog_drive_stalled_retry.sweep — the cause remains (ac-a6513809)', () => {
	it('does not retry green checks on a blocked merge state', async () => {
		mock_checks(GREEN, 'BLOCKED')
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})

	it.each([
		['a required context has no check-run', REQUIRED_CHECKS.map((name) => check_run(name))],
		[
			'a required check is red',
			[...GREEN.slice(1), check_run(GREEN[0]?.['name'] ?? '', 'FAILURE')],
		],
	])('does not retry when %s', async (_case, rollup) => {
		mock_checks(rollup)
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})

	it('does not retry when the lane has no readable pull request', async () => {
		vi.mocked(git_gh_pr_snapshot.pr_get_checks_snapshot).mockRejectedValue(new Error('no PR'))
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_stalled_retry.sweep — parks left for a person (ac-22d3aacd)', () => {
	it.each([
		[
			'a protected label',
			() =>
				vi
					.mocked(run_add_issue.read)
					.mockResolvedValue(issue([RUN_STALLED_LABEL, NEEDS_DECISION_LABEL])),
		],
		['no classification', () => mock_stream([park({})])],
		[
			'a stage with no check',
			() => mock_stream([park({ stop: { stage: 'review', cause: 'finding' } })]),
		],
		['the label already gone', () => vi.mocked(run_add_issue.read).mockResolvedValue(issue([]))],
		[
			'a closed issue',
			() => vi.mocked(run_add_issue.read).mockResolvedValue(issue([RUN_STALLED_LABEL], 'CLOSED')),
		],
	])('does not retry a park with %s', async (_case, arrange) => {
		arrange()
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_stalled_retry.sweep — the cap (ac-bc44aff6)', () => {
	const capped = [retry_event(0), retry_event(0), park()]

	it('restates the park with the cap note instead of retrying', async () => {
		mock_stream([park()], capped)
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			PARK,
			`#${String(PARKED)} parked (${RUN_STALLED_LABEL}: ${backlog_drive_stalled_retry.CAP_NOTE})`,
			expect.any(Date),
			{ stop: FOLLOWUP_STOP },
		)
	})

	it('shows the cap on the board row of the restated park', () => {
		const restated = park(undefined, backlog_drive_stalled_retry.CAP_NOTE)
		const reason = run_board_ending_reason.reason_of(restated) ?? ''

		expect(run_board_ending_reason.park_row_reason(PARKED, reason, true)).toBe(
			`→ resume: pnpm josh run:add ${String(PARKED)} --retry (${backlog_drive_stalled_retry.CAP_NOTE})`,
		)
	})

	it('restates the cap only once', async () => {
		mock_stream([park(undefined, backlog_drive_stalled_retry.CAP_NOTE)], capped)
		await next_sweep()

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
		expect(run_add_issue.read).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_named_offer.read — every offer (ac-078c5f7a)', () => {
	it('sweeps the parks before reading the offer, with no merge', async () => {
		const sweep = vi
			.spyOn(backlog_drive_stalled_retry, 'sweep')
			.mockRejectedValue(new Error('swept'))

		await expect(
			backlog_drive_named_offer.read(
				CARRY,
				{ in_flight: [], exclude: [], active: AT, retries: 0, is_stopping: false },
				{ is_only: false, forwarded: [], owner: 'owner' },
			),
		).rejects.toThrow('swept')
		expect(sweep).toHaveBeenCalledOnce()
	})
})
