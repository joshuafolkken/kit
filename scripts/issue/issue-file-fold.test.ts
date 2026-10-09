import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { split_assess } from '#scripts/split/split-assess'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_fold } from './issue-file-fold'
import { issue_fold_cli } from './issue-fold-cli'
import { SPLIT_ROUTE_LABEL } from './issue-labels'
import { issue_state_cli, type StateRead } from './issue-state-cli'

// joshuafolkken/kit#3423: `josh issue:file` asks the fold question itself, so a run's second filing
// needs no `issue:fold` call in front of it. The earlier filings are the run's own `filed` events, and
// the size is `issue:fold`'s reading of the diff — both stubbed here at the namespaces the module calls.

const AT = '2026-10-09T00:00:00.000Z'
const FINDER = '3415'
const EARLIER = 3501
const HERE = ''
const THERE = 'owner/dep'
const CURRENT = 'joshuafolkken/kit'
const NONE: ReadonlyArray<number> = []
const PLAIN = { route: undefined, distinct: NONE }

function state_read(state: string): StateRead {
	return { kind: 'state', state: { state, labels: [], is_human_review: false } }
}

function filed(text: string): RunEvent {
	return { pos: 0, at: AT, kind: run_event_stream.EVENT_KIND.FILED, text }
}

const OWN_FILING = filed(`#${String(EARLIER)} Count the seats again (found during #${FINDER})`)
const UPSTREAM_FILING = filed(`${THERE}#12 Fix the dependency (found during #${FINDER})`)
const OTHER_LANE_FILING = filed('#3502 Something another lane found (found during #3416)')
const PARENT_FILING = filed('#3503 Something the parent found')
const NOTE: RunEvent = {
	pos: 0,
	at: AT,
	kind: run_event_stream.EVENT_KIND.NOTE,
	text: `#${String(EARLIER)} x`,
}

const all_events = vi.spyOn(run_event_stream_emit, 'all_events')
const current_events = vi.spyOn(run_event_stream_emit, 'current_events')
const branch = vi.spyOn(git_command, 'branch')
const size_verdict = vi.spyOn(issue_fold_cli, 'size_verdict')
const error = vi.spyOn(console, 'error')
const read_issue = vi.spyOn(issue_state_cli, 'read_issue')

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	error.mockImplementation(() => undefined)
	vi.stubEnv(lane_child_marker.KEY, FINDER)
	all_events.mockResolvedValue([OWN_FILING])
	current_events.mockResolvedValue([PARENT_FILING])
	branch.mockResolvedValue('main')
	size_verdict.mockResolvedValue(split_assess.SINGLE_VERDICT)
	read_issue.mockResolvedValue(state_read('OPEN'))
})

afterEach(() => {
	vi.unstubAllEnvs()
	vi.clearAllMocks()
})

describe('issue_file_fold.prior_filings — the run’s earlier filings by the same finder', () => {
	const events = [OWN_FILING, UPSTREAM_FILING, OTHER_LANE_FILING, PARENT_FILING, NOTE]

	it('keeps only the filings the same lane child made in this repository', () => {
		const priors = issue_file_fold.prior_filings(events, FINDER, HERE, NONE)

		expect(priors.map((prior) => prior.reference)).toStrictEqual([`#${String(EARLIER)}`])
	})

	it('keeps only the filings in the repository the filing targets', () => {
		const priors = issue_file_fold.prior_filings(events, FINDER, THERE, NONE)

		expect(priors.map((prior) => prior.reference)).toStrictEqual([`${THERE}#12`])
	})

	it('keeps only the filings made with no finder when there is none', () => {
		const priors = issue_file_fold.prior_filings(events, undefined, HERE, NONE)

		expect(priors.map((prior) => prior.reference)).toStrictEqual(['#3503'])
	})

	it('leaves out a filing the caller declared distinct', () => {
		expect(issue_file_fold.prior_filings(events, FINDER, HERE, [EARLIER])).toStrictEqual([])
	})
})

describe('issue_file_fold.reference_prefix — what a filed reference carries before #N', () => {
	it('is empty for this repository named in another case, as the Origin check reads it', () => {
		expect(issue_file_fold.reference_prefix('JoshuaFolkken/kit', CURRENT)).toBe(HERE)
	})

	it('is the target for another repository', () => {
		expect(issue_file_fold.reference_prefix(THERE, CURRENT)).toBe(THERE)
	})
})

describe('issue_file_fold.finder — whose work turned the finding up', () => {
	it('is the lane child’s mark inside a lane', async () => {
		expect(await issue_file_fold.finder()).toBe(FINDER)
	})

	it('is the Issue the branch names outside a lane', async () => {
		vi.stubEnv(lane_child_marker.KEY, undefined)
		branch.mockResolvedValue('3423-let-issue-file-fold')

		expect(await issue_file_fold.finder()).toBe('3423')
	})

	it('is nobody on a branch that names no Issue, or when git cannot answer', async () => {
		vi.stubEnv(lane_child_marker.KEY, undefined)

		expect(await issue_file_fold.finder()).toBeUndefined()
		branch.mockRejectedValue(new Error('not a git repository'))
		expect(await issue_file_fold.finder()).toBeUndefined()
	})
})

describe('issue_file_fold.is_fold_clear — the verdict at the call that files', () => {
	it('clears a run’s first filing without measuring anything', async () => {
		all_events.mockResolvedValue([])

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(true)
		expect(size_verdict).not.toHaveBeenCalled()
	})

	it('holds a second filing whose size is under the guide and names the Issue to fold into', async () => {
		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(`#${String(EARLIER)}`))
		expect(error).toHaveBeenCalledWith(expect.stringContaining(`--distinct ${String(EARLIER)}`))
	})

	it('clears a second filing whose combined size clears the split guide', async () => {
		size_verdict.mockResolvedValue(split_assess.SPLIT_VERDICT)

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(true)
	})

	it('clears a second filing whose size the diff cannot measure, rather than folding it', async () => {
		size_verdict.mockResolvedValue(undefined)

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(true)
		expect(error).not.toHaveBeenCalled()
	})

	it('clears a second filing that declares the earlier one distinct', async () => {
		expect(
			await issue_file_fold.is_fold_clear(HERE, { route: undefined, distinct: [EARLIER] }),
		).toBe(true)
	})
})

describe('issue_file_fold.is_fold_clear — which earlier filings it reads', () => {
	it('reads a finder’s filings off the whole stream, so a run with no carry record still folds', async () => {
		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(false)
		expect(current_events).not.toHaveBeenCalled()
	})

	it('reads the carry-scoped invocation when there is no finder', async () => {
		vi.stubEnv(lane_child_marker.KEY, undefined)

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('#3503'))
	})

	it('clears a filing into another repository than the earlier one', async () => {
		expect(await issue_file_fold.is_fold_clear(THERE, PLAIN)).toBe(true)
	})

	it('clears a split child without reading the stream, as the split assessment decided it', async () => {
		const split = { route: SPLIT_ROUTE_LABEL, distinct: NONE }

		expect(await issue_file_fold.is_fold_clear(HERE, split)).toBe(true)
		expect(all_events).not.toHaveBeenCalled()
	})

	it('leaves out an earlier filing that has closed since, so nothing folds out of the backlog', async () => {
		read_issue.mockResolvedValue(state_read('CLOSED'))

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(true)
		expect(read_issue).toHaveBeenCalledWith(String(EARLIER), undefined)
	})

	it('keeps an earlier filing whose state could not be read', async () => {
		read_issue.mockResolvedValue({ kind: 'unreadable' })

		expect(await issue_file_fold.is_fold_clear(HERE, PLAIN)).toBe(false)
	})

	it('reads an earlier filing’s state in the repository it was filed in', async () => {
		all_events.mockResolvedValue([UPSTREAM_FILING])

		await issue_file_fold.is_fold_clear(THERE, PLAIN)

		expect(read_issue).toHaveBeenCalledWith('12', THERE)
	})
})
