import { git_gh_command } from '#scripts/gh/git-gh-command'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { josh_command } from '#scripts/josh/josh-run'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { backlog_drive_retry } from './backlog-drive-retry'

const CAUSE = 6428
const PARKED = 6429
const OTHER = 6400
const SIBLING = 6430
const LATER = '2026-11-05T00:01Z'
const REPO = 'joshuafolkken/kit'
const HISTORY_ERROR = 'history failed'
const DEPENDENCY_ERROR = 'all dependencies'

function relation(state = 'CLOSED', number = CAUSE): { number: number; state: string } {
	return { number, state }
}

function mock_issue(nodes = [relation()], total_count = nodes.length, state = 'OPEN'): void {
	vi.mocked(git_gh_command.issue_get_state_and_relations_classified).mockResolvedValue({
		kind: 'read',
		json: JSON.stringify({ number: PARKED, state, blockedBy: { nodes, totalCount: total_count } }),
	})
}

beforeEach(() => {
	vi.spyOn(run_event_stream_emit, 'current_events').mockResolvedValue([
		{ pos: 1, kind: 'park', text: `#${String(PARKED)} stopped`, at: '2026-11-05T00:00Z' },
	])
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(REPO)
	vi.spyOn(git_gh_command, 'issue_get_state_and_relations_classified')
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: 'queued' })
	mock_issue()
})

afterEach(() => vi.restoreAllMocks())

it('retries a parked native dependent through the existing command (ac-846abec4)', async () => {
	await backlog_drive_retry.after_merge(CAUSE)

	expect(run_event_stream_emit.current_events).toHaveBeenCalledWith(true)
	expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(
		['run:add', String(PARKED), '--retry'],
		true,
	)
})

it.each(['OPEN', 'UNKNOWN'])(
	'protects another unresolved blocker: %s (ac-505a5dfa)',
	async (state) => {
		mock_issue([relation(), relation(state, OTHER)])
		await backlog_drive_retry.after_merge(CAUSE)

		expect(josh_command.josh_run).not.toHaveBeenCalled()
	},
)

it.each([
	{ nodes: [relation('CLOSED', OTHER)], state: 'OPEN' },
	{ nodes: [relation()], state: 'CLOSED' },
	{ nodes: [relation('OPEN')], state: 'OPEN' },
])('skips a non-target $state $nodes (ac-87721981)', async ({ nodes, state }) => {
	mock_issue(nodes, nodes.length, state)
	await backlog_drive_retry.after_merge(CAUSE)

	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

it('does not read or retry an issue with no current park (ac-87721981)', async () => {
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([])
	await backlog_drive_retry.after_merge(CAUSE)

	expect(git_gh_command.issue_get_state_and_relations_classified).not.toHaveBeenCalled()
	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

it('allows several closed dependencies', async () => {
	mock_issue([relation(), relation('CLOSED', OTHER)])
	await backlog_drive_retry.after_merge(CAUSE)

	expect(josh_command.josh_run).toHaveBeenCalledOnce()
})

it('does not match the cause number in another repository', async () => {
	vi.mocked(git_gh_command.issue_get_state_and_relations_classified).mockResolvedValue({
		kind: 'read',
		json: JSON.stringify({
			number: PARKED,
			state: 'OPEN',
			blockedBy: {
				nodes: [{ ...relation(), repository_url: 'https://api.github.com/repos/other/repo' }],
				totalCount: 1,
			},
		}),
	})
	await backlog_drive_retry.after_merge(CAUSE)

	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

it('ignores a park from an earlier attempt', async () => {
	const events = await run_event_stream_emit.current_events(true)

	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
		...events,
		{ pos: 2, kind: 'add', text: `retry #${String(PARKED)}`, at: LATER },
	])
	await backlog_drive_retry.after_merge(CAUSE)

	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

it('propagates an unreadable dependent (ac-e6cfefaf)', async () => {
	vi.mocked(git_gh_command.issue_get_state_and_relations_classified).mockResolvedValue({
		kind: 'unreadable',
		reason: 'unreachable',
		status: undefined,
	})

	await expect(backlog_drive_retry.after_merge(CAUSE)).rejects.toThrow(DEPENDENCY_ERROR)
})

it('propagates unreadable park history (ac-e6cfefaf)', async () => {
	vi.mocked(run_event_stream_emit.current_events).mockRejectedValue(new Error(HISTORY_ERROR))

	await expect(backlog_drive_retry.after_merge(CAUSE)).rejects.toThrow(HISTORY_ERROR)
	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

it('refuses truncated native dependencies (ac-e6cfefaf)', async () => {
	mock_issue([relation()], 2)

	await expect(backlog_drive_retry.after_merge(CAUSE)).rejects.toThrow(DEPENDENCY_ERROR)
	expect(josh_command.josh_run).not.toHaveBeenCalled()
})

function issue_json(number: number, labels: ReadonlyArray<string>): string {
	return JSON.stringify({
		number,
		state: 'OPEN',
		labels: labels.map((name) => ({ name })),
		blockedBy: { nodes: [relation()], totalCount: 1 },
	})
}

function mock_by_issue(labels_of: ReadonlyMap<number, ReadonlyArray<string>>): void {
	vi.mocked(git_gh_command.issue_get_state_and_relations_classified).mockImplementation(
		async (issue) => {
			const number = Number(issue)

			return { kind: 'read', json: issue_json(number, labels_of.get(number) ?? []) }
		},
	)
}

it('re-parks a needs-decision dependent with the reason instead of throwing (ac-ef909ee8)', async () => {
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	mock_by_issue(new Map([[PARKED, [NEEDS_DECISION_LABEL]]]))

	await expect(backlog_drive_retry.after_merge(CAUSE)).resolves.toBeUndefined()

	expect(josh_command.josh_run).not.toHaveBeenCalled()
	expect(run_event_stream_emit.emit).toHaveBeenCalledExactlyOnceWith(
		run_event_stream.EVENT_KIND.PARK,
		`#${String(PARKED)} parked (${NEEDS_DECISION_LABEL}; blocker #${String(CAUSE)} closed)`,
	)
})

it('goes on retrying the round after a protected dependent (ac-a55c13d2)', async () => {
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.mocked(run_event_stream_emit.current_events).mockResolvedValue([
		...(await run_event_stream_emit.current_events(true)),
		{ pos: 2, kind: 'park', text: `#${String(SIBLING)} stopped`, at: LATER },
	])
	mock_by_issue(new Map([[PARKED, [NEEDS_DECISION_LABEL]]]))
	await backlog_drive_retry.after_merge(CAUSE)

	expect(josh_command.josh_run).toHaveBeenCalledExactlyOnceWith(
		['run:add', String(SIBLING), '--retry'],
		true,
	)
})

it('propagates retry command failure (ac-e6cfefaf)', async () => {
	vi.mocked(josh_command.josh_run).mockResolvedValue({ code: 1, out: 'refused' })

	await expect(backlog_drive_retry.after_merge(CAUSE)).rejects.toThrow('Could not retry')
})
