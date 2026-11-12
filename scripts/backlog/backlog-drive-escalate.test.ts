import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EpicIssue } from '#scripts/epic/epic-issue'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { NEEDS_DECISION_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { josh_command } from '#scripts/josh/josh-run'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { run_add_issue } from '#scripts/run/add/run-add-issue'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_budget } from './backlog-budget'
import { backlog_drive_escalate } from './backlog-drive-escalate'
import { backlog_drive_stalled_retry } from './backlog-drive-stalled-retry'

const ISSUE = 7357
const DIRECTORY = path.join(os.tmpdir(), 'josh-test-escalate', String(ISSUE))
const REASON = 'escalation requested: needs a stronger model'
const HAIKU = { name: 'haiku', model: 'claude-haiku-5-5', effort: 'low', when: 'Mechanical work' }
const SONNET = { name: 'sonnet', model: 'claude-sonnet-5-5', effort: 'medium', when: 'A brief' }
const PROFILES = [HAIKU, SONNET]
const HAIKU_LABEL = 'worker:haiku'
const SONNET_LABEL = 'worker:sonnet'

function write_worker(worker: Record<string, unknown> | undefined): void {
	mkdirSync(DIRECTORY, { recursive: true })
	const josh = worker === undefined ? {} : { josh: { worker } }

	writeFileSync(path.join(DIRECTORY, PACKAGE_JSON), JSON.stringify(josh), 'utf8')
}

function ports(labels: ReadonlyArray<string> | undefined = []): {
	labels: () => Promise<ReadonlyArray<string> | undefined>
	retry: (issue: number) => Promise<void>
} {
	return {
		labels: vi.fn(async () => labels),
		retry: vi.fn<(issue: number) => Promise<void>>().mockResolvedValue(),
	}
}

function posted_comment(): string {
	return vi.mocked(git_gh_issue_write.issue_try_comment).mock.calls[0]?.[1] ?? ''
}

beforeEach(() => {
	vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_clear_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_try_comment').mockResolvedValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(DIRECTORY, { recursive: true, force: true })
})

describe('backlog_drive_escalate.escalate — one profile up', () => {
	it('moves the worker label one profile up, records it and resumes the lane (ac-ce404c73, ac-3271a882)', async () => {
		write_worker({ default: HAIKU.name, escalate: true, profiles: PROFILES })
		const given = ports([HAIKU_LABEL])

		await backlog_drive_escalate.escalate(ISSUE, REASON, given, DIRECTORY)

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledWith(String(ISSUE), SONNET_LABEL)
		expect(git_gh_issue_write.issue_clear_label).toHaveBeenCalledWith(String(ISSUE), HAIKU_LABEL)
		const comment = posted_comment()

		expect(comment).toContain('from `worker:haiku` (claude-haiku-5-5 / low)')
		expect(comment).toContain('to `worker:sonnet` (claude-sonnet-5-5 / medium)')
		expect(comment).toContain(`Reason: ${REASON}`)
		expect(given.retry).toHaveBeenCalledExactlyOnceWith(ISSUE)
	})

	it('steps up from the default profile when the Issue carries no worker label', async () => {
		write_worker({ default: HAIKU.name, escalate: true, profiles: PROFILES })
		const given = ports([RUN_STALLED_LABEL])

		await backlog_drive_escalate.escalate(ISSUE, REASON, given, DIRECTORY)

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledWith(String(ISSUE), SONNET_LABEL)
		expect(given.retry).toHaveBeenCalledOnce()
	})

	it('leaves the park for a person when the label cannot be moved', async () => {
		write_worker({ default: HAIKU.name, escalate: true, profiles: PROFILES })
		vi.mocked(git_gh_issue_write.issue_clear_label).mockResolvedValue(false)
		vi.spyOn(console, 'error').mockReturnValue()
		const given = ports([HAIKU_LABEL])

		await backlog_drive_escalate.escalate(ISSUE, REASON, given, DIRECTORY)

		expect(given.retry).not.toHaveBeenCalled()
		expect(git_gh_issue_write.issue_try_comment).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_escalate.escalate — the top profile', () => {
	it('parks for a person with the reason instead of resuming (ac-9bd0a2f6)', async () => {
		write_worker({ default: HAIKU.name, escalate: true, profiles: PROFILES })
		const given = ports([SONNET_LABEL])

		await backlog_drive_escalate.escalate(ISSUE, REASON, given, DIRECTORY)

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledExactlyOnceWith(
			String(ISSUE),
			NEEDS_DECISION_LABEL,
		)
		const comment = posted_comment()

		expect(comment).toContain('`worker:sonnet` is the top')
		expect(comment).toContain(`Reason: ${REASON}`)
		expect(given.retry).not.toHaveBeenCalled()
	})
})

describe('backlog_drive_escalate.escalate — escalation off (ac-27b942cc)', () => {
	it.each([
		['no josh.worker setting', undefined],
		['josh.worker without escalate', { default: HAIKU.name, profiles: PROFILES }],
	])('does nothing with %s, reading no labels', async (_case, worker) => {
		write_worker(worker)
		const given = ports([HAIKU_LABEL])

		await backlog_drive_escalate.escalate(ISSUE, REASON, given, DIRECTORY)

		expect(given.labels).not.toHaveBeenCalled()
		expect(git_gh_issue_write.issue_add_label).not.toHaveBeenCalled()
		expect(given.retry).not.toHaveBeenCalled()
	})
})

function stalled_issue(labels: ReadonlyArray<string>): EpicIssue {
	return {
		number: ISSUE,
		title: '',
		body: '',
		state: 'OPEN',
		url: '',
		labels: labels.map((name) => ({ name })),
		blockedBy: undefined,
	}
}

function escalation_park(): RunEvent {
	const { short } = run_stalled.escalation_requested('needs a stronger model')

	return {
		pos: 1,
		kind: run_event_stream.EVENT_KIND.PARK,
		text: run_stalled.park_event(String(ISSUE), short),
		at: '2026-11-12T10:00:00Z',
	}
}

const sweep_clock = { now: Date.now() }

// One sweep of a lone escalation park, `run:add` exiting with `code`, past the sweep throttle.
async function sweep_escalation(code: number): Promise<void> {
	write_worker({ default: HAIKU.name, escalate: true, profiles: PROFILES })
	vi.spyOn(process, 'cwd').mockReturnValue(DIRECTORY)
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([escalation_park()])
	vi.spyOn(run_event_stream_emit, 'all_events').mockResolvedValue([escalation_park()])
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(run_add_issue, 'read').mockResolvedValue(stalled_issue([RUN_STALLED_LABEL]))
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code, out: '' })
	sweep_clock.now += backlog_budget.OFFER_INTERVAL_MS
	await backlog_drive_stalled_retry.sweep(sweep_clock.now)
}

describe('backlog_drive_stalled_retry.sweep — an escalation park', () => {
	it('resumes the lane one profile up through run:add --retry', async () => {
		await sweep_escalation(0)

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledWith(String(ISSUE), SONNET_LABEL)
		expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(
			['run:add', String(ISSUE), '--retry'],
			true,
		)
		expect(run_event_stream_emit.emit).not.toHaveBeenCalled()
	})

	it('restates a refused resume, so the next sweep does not escalate the moved label again', async () => {
		vi.spyOn(console, 'error').mockReturnValue()
		await sweep_escalation(1)
		const [kind, text = ''] = vi.mocked(run_event_stream_emit.emit).mock.calls[0] ?? []

		expect(kind).toBe(run_event_stream.EVENT_KIND.PARK)
		expect(run_stalled.class_of(run_stalled.cause_in(text) ?? '')).not.toBe(
			run_stalled.ESCALATION_REQUESTED.short,
		)
	})
})
