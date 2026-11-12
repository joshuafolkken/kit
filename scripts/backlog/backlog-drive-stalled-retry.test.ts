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
import { run_stalled } from '#scripts/run/park/run-stalled'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'
import { backlog_yield_cap } from './backlog-yield-cap'

const { CAP_NOTE } = backlog_drive_stalled_retry

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
		expect(console.error).toHaveBeenCalledExactlyOnceWith(
			`Error: Could not retry #${String(PARKED)} automatically. Left for a person.`,
		)
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
		['no stop and a cause with no check', () => mock_stream([park({})])],
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

describe('backlog_drive_stalled_retry.sweep — the cap (ac-bc44aff6, ac-328f94e0)', () => {
	const capped = [retry_event(0), retry_event(0), park()]

	it("counts a restarted drive's earlier retries off the whole stream, restating the park with the cap note and its cause", async () => {
		mock_stream([park()], capped)
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			PARK,
			`#${String(PARKED)} parked (${RUN_STALLED_LABEL}: ${CAP_NOTE} — ship-stop cap)`,
			expect.any(Date),
			{ stop: FOLLOWUP_STOP },
		)
	})

	it('shows the cap and the cause on the board row of the restated park (ac-9b3cdd83)', () => {
		const restated = park(undefined, `${CAP_NOTE} — ${run_stalled.SESSION_UNFINISHED.short}`)
		const reason = run_board_ending_reason.reason_of(restated) ?? ''

		expect(run_board_ending_reason.park_row_reason(PARKED, reason, true)).toBe(
			`→ resume: pnpm josh run:add ${String(PARKED)} --retry (${CAP_NOTE} — session unfinished)`,
		)
	})

	it('restates the cap only once', async () => {
		mock_stream([park(undefined, CAP_NOTE)], capped)
		await next_sweep()

		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
		expect(run_add_issue.read).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#7076: `run:merge`'s causes name nothing a read could show cleared.
describe('backlog_drive_stalled_retry.sweep — a park with no stop (ac-a7d6e211)', () => {
	it.each([
		run_stalled.SESSION_UNFINISHED.short,
		run_stalled.CUT_NOT_RELAUNCHED.short,
		run_stalled.STALE_HANDOFF.short,
		run_stalled.session_unfinished('Implementation done; gate red on lint.').short,
	])('retries a %s park on the next sweep, reading no pull request', async (cause) => {
		mock_stream([park({}, cause)])
		await next_sweep()

		expect(git_gh_pr_snapshot.pr_get_checks_snapshot).not.toHaveBeenCalled()
		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, true)
	})
})

// A yield-cap park parked `at` milliseconds into the test clock.
function yield_park(at: number): RunEvent {
	return { ...park({}, backlog_yield_cap.TRIP_CAUSE), at: new Date(at).toISOString() }
}

// The park instant whose window has passed exactly at the next sweep's clock.
function due_at(): number {
	return clock.now + backlog_budget.OFFER_INTERVAL_MS - backlog_yield_cap.WINDOW_MS
}

describe('backlog_drive_stalled_retry.sweep — a yield-cap park (ac-1737b91a)', () => {
	it('does not retry before its window has passed', async () => {
		mock_stream([yield_park(due_at() + 1)])
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	})

	it('retries once its window has passed', async () => {
		mock_stream([yield_park(due_at())])
		await next_sweep()

		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(RETRY_ARGV, true)
	})

	it('reaches the cap on the third trip, naming the cause', async () => {
		const trip = yield_park(due_at())

		mock_stream([trip], [retry_event(0), retry_event(0), trip])
		await next_sweep()

		expect(josh_command.josh_run).not.toHaveBeenCalled()
		expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
			PARK,
			`#${String(PARKED)} parked (${RUN_STALLED_LABEL}: ${CAP_NOTE} — ${backlog_yield_cap.TRIP_CAUSE})`,
			expect.any(Date),
			{},
		)
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
